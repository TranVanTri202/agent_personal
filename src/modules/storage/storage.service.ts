import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorageProvider } from './local-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';
import { SupabaseStorageClient } from './supabase-storage.client';
import { TemporaryStorageService } from './temporary-storage.service';
import { ActorContext, FileExpiredError, FileAccessDeniedError } from './temporary-storage.types';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { StoredFile } from '@prisma/client';

@Injectable()
export class StorageService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly localProvider: LocalStorageProvider,
    private readonly r2Provider: R2StorageProvider,
    private readonly supabaseStorageClient: SupabaseStorageClient,
    private readonly temporaryStorageService: TemporaryStorageService,
    private readonly logger: AppLoggerService,
  ) {}

  isPubliclyAccessible(): boolean {
    return this.supabaseStorageClient.isConfigured();
  }

  getTemporaryStorageService(): TemporaryStorageService {
    return this.temporaryStorageService;
  }

  getSupabaseClient(): SupabaseStorageClient {
    return this.supabaseStorageClient;
  }

  /**
   * Saves a temporary file (Excel, PDF, Word, Image, etc.) with strict 24-hour TTL.
   */
  async saveFile(params: {
    ownerId?: string;
    taskId?: string;
    conversationId?: string;
    objectKey?: string;
    buffer: Buffer;
    mimeType: string;
    originalName?: string;
  }): Promise<StoredFile> {
    const filename = params.originalName || path.basename(params.objectKey || 'file.bin');

    const result = await this.temporaryStorageService.uploadTemporaryFile({
      file: params.buffer,
      filename,
      mimeType: params.mimeType,
      ownerId: params.ownerId,
      conversationId: params.conversationId,
      taskId: params.taskId,
    });

    const file = await this.prisma.storedFile.findUnique({
      where: { id: result.fileId },
    });

    if (!file) {
      throw new Error(`Failed to retrieve stored file #${result.fileId}`);
    }

    return file;
  }

  /**
   * Generates a signed download URL valid only for the remaining lifetime of the file (<= 24h).
   */
  async getDownloadLink(
    fileIdOrKey: string,
    actorContext?: ActorContext,
  ): Promise<{ url?: string; message?: string; localPath?: string; expiresAt?: Date; isExpired?: boolean }> {
    const file = await this.prisma.storedFile.findFirst({
      where: {
        OR: [{ id: fileIdOrKey }, { objectKey: fileIdOrKey }],
      },
    });

    if (!file) {
      return { message: 'Không tìm thấy file trong hệ thống.' };
    }

    // Check expiry
    const now = new Date();
    if (file.status === 'DELETED' || file.status === 'DELETING' || (file.expiresAt && file.expiresAt.getTime() <= now.getTime())) {
      return {
        isExpired: true,
        message: '⚠️ Tệp tin này đã hết hạn lưu trữ tạm (24 giờ) và đã được xóa tự động khỏi hệ thống.',
      };
    }

    if (file.provider === 'SUPABASE' && this.supabaseStorageClient.isConfigured()) {
      try {
        const url = await this.temporaryStorageService.createTemporaryDownloadUrl(file.id, actorContext);
        const hoursRemaining = file.expiresAt
          ? Math.max(1, Math.round((file.expiresAt.getTime() - Date.now()) / (3600 * 1000)))
          : 24;

        return {
          url,
          expiresAt: file.expiresAt || undefined,
          message: `🔗 Link tải có hiệu lực trong ${hoursRemaining} giờ (kể từ lúc tạo file) ⏰:\n${url}`,
        };
      } catch (err: any) {
        if (err instanceof FileExpiredError) {
          return {
            isExpired: true,
            message: '⚠️ Tệp tin này đã hết hạn lưu trữ tạm (24 giờ) và đã được xóa tự động khỏi hệ thống.',
          };
        }
        if (err instanceof FileAccessDeniedError) {
          return {
            message: '⛔ Bạn không có quyền truy cập tệp tin riêng tư này.',
          };
        }
        this.logger.error(`[STORAGE_LINK_ERROR] ${err.message}`);
        return { message: `Lỗi tạo link tải: ${err.message}` };
      }
    }

    // Local Storage fallback
    const localRoot = this.configService.get<string>('LOCAL_STORAGE_ROOT') || './data';
    const localPath = path.resolve(process.cwd(), localRoot, file.objectKey);
    return {
      localPath,
      expiresAt: file.expiresAt || undefined,
      message:
        `📁 File đã lưu tại máy tính của bạn:\n\`${localPath}\`\n\n` +
        `💡 (Để bot sinh link HTTPS tải trực tiếp trên Zalo, bạn cấu hình Supabase Storage trong .env).`,
    };
  }

  /**
   * Retrieves buffer of an active file if not expired.
   */
  async getFileBuffer(
    fileIdOrKey: string,
  ): Promise<{ buffer: Buffer; mimeType: string; originalName: string; file: StoredFile } | null> {
    const file = await this.prisma.storedFile.findFirst({
      where: {
        OR: [{ id: fileIdOrKey }, { objectKey: fileIdOrKey }],
      },
    });

    if (!file) return null;

    // Check expiry
    const now = new Date();
    if (file.status === 'DELETED' || (file.expiresAt && file.expiresAt.getTime() <= now.getTime())) {
      this.logger.warn(`[STORAGE] Attempted to get buffer of expired file #${file.id}`);
      return null;
    }

    if (file.provider === 'SUPABASE' && this.supabaseStorageClient.isConfigured()) {
      try {
        const client = this.supabaseStorageClient.getClient();
        if (client) {
          const { data, error } = await client.storage
            .from(this.supabaseStorageClient.getBucketName())
            .download(file.objectKey);

          if (!error && data) {
            const arrayBuffer = await data.arrayBuffer();
            return {
              buffer: Buffer.from(arrayBuffer),
              mimeType: file.mimeType,
              originalName: file.originalName,
              file,
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`[STORAGE_SUPABASE_BUFFER_ERROR] Download error: ${err.message}`);
      }
    }

    // Fallback to local provider if available
    try {
      const buffer = await this.localProvider.get(file.objectKey);
      return {
        buffer,
        mimeType: file.mimeType,
        originalName: file.originalName,
        file,
      };
    } catch {
      return null;
    }
  }

  async getFileById(fileId: string): Promise<StoredFile | null> {
    return this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });
  }

  /**
   * Lists active, non-expired files for an owner.
   */
  async listFiles(ownerId?: string): Promise<StoredFile[]> {
    return this.prisma.storedFile.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
        ...(ownerId ? { ownerId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
