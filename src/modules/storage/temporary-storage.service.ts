import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import * as crypto from 'crypto';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { SupabaseStorageClient } from './supabase-storage.client';
import { LocalStorageProvider } from './local-storage.provider';
import {
  TEMP_FILE_TTL_MS,
  TEMPORARY_FILES_QUEUE_NAME,
  DELETE_TEMPORARY_FILE_JOB,
  TemporaryFileResult,
  UploadTemporaryFileInput,
  ActorContext,
  FileExpiredError,
  FileAccessDeniedError,
} from './temporary-storage.types';
import { StoredFile } from '@prisma/client';

@Injectable()
export class TemporaryStorageService {
  constructor(
    @InjectQueue(TEMPORARY_FILES_QUEUE_NAME) private readonly temporaryFileQueue: Queue<{ fileId: string }>,
    private readonly prisma: PrismaService,
    private readonly supabaseStorageClient: SupabaseStorageClient,
    private readonly localProvider: LocalStorageProvider,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Uploads a file to private Supabase temporary storage (or local fallback),
   * records 24h metadata in PostgreSQL, and enqueues BullMQ delayed deletion.
   */
  async uploadTemporaryFile(input: UploadTemporaryFileInput): Promise<TemporaryFileResult> {
    // 1. Normalize Buffer
    let buffer: Buffer;
    if (Buffer.isBuffer(input.file)) {
      buffer = input.file;
    } else if (input.file instanceof Uint8Array) {
      buffer = Buffer.from(input.file);
    } else {
      // Stream
      const chunks: Buffer[] = [];
      for await (const chunk of input.file as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    }

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeOwnerId = (input.ownerId || 'system').replace(/[^a-zA-Z0-9_-]/g, '_');
    const rawExt = path.extname(input.filename) || '';
    const safeExt = rawExt.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();
    const objectPath = `temp/${safeOwnerId}/${yyyy}/${mm}/${uuid}${safeExt}`;

    const isSupabase = this.supabaseStorageClient.isConfigured();
    const bucket = isSupabase ? this.supabaseStorageClient.getBucketName() : 'local';

    // 2. Storage upload
    if (isSupabase) {
      await this.supabaseStorageClient.uploadObject({
        path: objectPath,
        file: buffer,
        contentType: input.mimeType,
        upsert: false,
      });
    } else {
      await this.localProvider.put({
        objectKey: objectPath,
        buffer,
        mimeType: input.mimeType,
        originalName: input.filename,
      });
    }

    // 3. PostgreSQL metadata (Source of Truth)
    const uploadedAt = new Date();
    const expiresAt = new Date(uploadedAt.getTime() + TEMP_FILE_TTL_MS); // Exact 24 hours in UTC

    let storedFile: StoredFile;
    try {
      storedFile = await this.prisma.storedFile.create({
        data: {
          id: uuid,
          ownerId: input.ownerId || null,
          taskId: input.taskId || null,
          conversationId: input.conversationId || null,
          provider: isSupabase ? 'SUPABASE' : 'LOCAL',
          bucket,
          objectKey: objectPath,
          originalName: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(buffer.length),
          checksum,
          status: 'ACTIVE',
          uploadedAt,
          expiresAt,
          createdAt: uploadedAt,
          updatedAt: uploadedAt,
        },
      });
    } catch (dbErr: any) {
      this.logger.error(`[TEMP_STORAGE_DB_ERROR] Failed recording metadata for ${objectPath}: ${dbErr.message}`);
      // Compensation: remove the uploaded storage object to prevent orphan leak
      if (isSupabase) {
        await this.supabaseStorageClient.removeObjects([objectPath]).catch((remErr) => {
          this.logger.warn(`[TEMP_STORAGE_COMPENSATION_FAIL] Orphan object ${objectPath}: ${remErr.message}`);
        });
      }
      throw new Error(`Database error saving temporary file metadata: ${dbErr.message}`);
    }

    // 4. Layer A: Enqueue BullMQ delayed job for exact per-file 24h deletion
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    try {
      await this.temporaryFileQueue.add(
        DELETE_TEMPORARY_FILE_JOB,
        { fileId: storedFile.id },
        {
          jobId: `temp-delete-${storedFile.id}`,
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
        },
      );
      this.logger.log(`[TEMP_STORAGE_QUEUED] Enqueued 24h deletion job for file #${storedFile.id} (delay: ${Math.round(delay / 1000)}s)`);
    } catch (queueErr: any) {
      this.logger.warn(`[TEMP_STORAGE_QUEUE_WARN] Could not enqueue deletion job for file #${storedFile.id}: ${queueErr.message}. Sweeper will handle.`);
    }

    // 5. Initial signed URL if Supabase
    let downloadUrl: string | undefined;
    if (isSupabase) {
      try {
        const isImage = input.mimeType?.startsWith('image/');
        const downloadFilename = isImage ? undefined : input.filename;
        downloadUrl = await this.supabaseStorageClient.createSignedUrl(objectPath, 24 * 60 * 60, downloadFilename);
      } catch (e: any) {
        this.logger.warn(`[TEMP_STORAGE] Failed generating initial signed url: ${e.message}`);
      }
    }

    return {
      fileId: storedFile.id,
      bucket,
      objectPath,
      originalFilename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: buffer.length,
      uploadedAt,
      expiresAt,
      downloadUrl,
    };
  }

  /**
   * Creates a signed download URL valid only for the remaining lifetime of the file (<= 24h).
   */
  async createTemporaryDownloadUrl(fileId: string, actorContext?: ActorContext): Promise<string> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new Error(`Không tìm thấy file với mã "${fileId}".`);
    }

    // Check status
    if (file.status === 'DELETED' || file.status === 'DELETING') {
      throw new FileExpiredError();
    }

    // Check TTL
    const now = Date.now();
    const expiresAtMs = file.expiresAt ? file.expiresAt.getTime() : file.createdAt.getTime() + TEMP_FILE_TTL_MS;
    const secondsRemaining = Math.floor((expiresAtMs - now) / 1000);

    if (secondsRemaining <= 0) {
      // Trigger background deletion
      this.deleteExpiredFile(file.id).catch(() => {});
      throw new FileExpiredError();
    }

    // Permission check
    if (actorContext?.userId && file.ownerId && file.ownerId !== actorContext.userId && !actorContext.isOwner) {
      throw new FileAccessDeniedError();
    }

    const expiresInSeconds = Math.max(1, Math.min(secondsRemaining, 24 * 60 * 60));

    if (file.provider === 'SUPABASE' && this.supabaseStorageClient.isConfigured()) {
      // For images, we do NOT want 'Content-Disposition: attachment' because Zalo servers and mobile apps
      // expect 'inline' images. If 'attachment' is set, Zalo image decoders fail and render a black screen.
      const isImage = file.mimeType?.startsWith('image/');
      const downloadFilename = isImage ? undefined : file.originalName;
      return this.supabaseStorageClient.createSignedUrl(file.objectKey, expiresInSeconds, downloadFilename);
    }

    // Local storage
    return `file://${path.resolve(process.cwd(), './data', file.objectKey)}`;
  }

  /**
   * Deletes an expired file from Storage and marks record DELETED in PostgreSQL.
   * Idempotent and safe against parallel worker executions.
   */
  async deleteExpiredFile(fileId: string): Promise<void> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      this.logger.warn(`[TEMP_STORAGE_CLEANUP] File #${fileId} not found in DB. Skipping.`);
      return;
    }

    if (file.status === 'DELETED') {
      return;
    }

    // Check that file is indeed past expiry before deleting
    const now = new Date();
    if (file.expiresAt && file.expiresAt.getTime() > now.getTime()) {
      this.logger.warn(`[TEMP_STORAGE_CLEANUP] File #${fileId} has not expired yet (${file.expiresAt.toISOString()} > ${now.toISOString()}). Skipping.`);
      return;
    }

    // Atomic lease update: mark DELETING
    await this.prisma.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'DELETING',
        deleteAttemptCount: { increment: 1 },
        lastDeleteAttemptAt: now,
      },
    });

    try {
      if (file.provider === 'SUPABASE' && this.supabaseStorageClient.isConfigured()) {
        await this.supabaseStorageClient.removeObjects([file.objectKey]);
      } else {
        await this.localProvider.delete(file.objectKey).catch(() => {});
      }

      await this.prisma.storedFile.update({
        where: { id: fileId },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });

      this.logger.log(`[TEMP_STORAGE_DELETED] Successfully deleted expired file #${fileId} ("${file.objectKey}")`);
    } catch (err: any) {
      this.logger.error(`[TEMP_STORAGE_DELETE_ERROR] Failed deleting file #${fileId}: ${err.message}`);
      await this.prisma.storedFile.update({
        where: { id: fileId },
        data: {
          status: 'DELETE_FAILED',
          lastErrorCode: err.message,
        },
      });
      throw err; // Allow BullMQ retry
    }
  }

  /**
   * Layer B: Sweeper that scans PostgreSQL for expired active files and deletes them.
   */
  async sweepExpiredFiles(batchSize = 50): Promise<{ sweptCount: number; failedCount: number }> {
    const now = new Date();
    let sweptCount = 0;
    let failedCount = 0;

    const expiredFiles = await this.prisma.storedFile.findMany({
      where: {
        status: { in: ['ACTIVE', 'DELETE_FAILED'] },
        expiresAt: { lte: now },
      },
      take: batchSize,
      orderBy: { expiresAt: 'asc' },
    });

    for (const f of expiredFiles) {
      try {
        await this.deleteExpiredFile(f.id);
        sweptCount++;
      } catch (err: any) {
        failedCount++;
        this.logger.warn(`[TEMP_STORAGE_SWEEPER_ERROR] Sweeper failed for #${f.id}: ${err.message}`);
      }
    }

    if (expiredFiles.length > 0) {
      this.logger.log(`[TEMP_STORAGE_SWEEP_DONE] Sweeper processed ${expiredFiles.length} file(s): ${sweptCount} deleted, ${failedCount} failed.`);
    }

    return { sweptCount, failedCount };
  }
}
