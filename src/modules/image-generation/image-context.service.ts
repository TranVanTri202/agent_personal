import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface RecentImageRecord {
  fileId: string;
  imageId?: string;
  objectKey: string;
  mimeType: string;
  sourceUrl?: string;
  timestamp: number;
}

@Injectable()
export class ImageContextService {
  // chatId -> RecentImageRecord for user input images
  private recentInputs = new Map<string, RecentImageRecord>();
  // chatId -> RecentImageRecord for bot output images
  private recentOutputs = new Map<string, RecentImageRecord>();

  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Records an image sent by the user to the chat.
   * Downloads the image from Zalo CDN, stores it durably in StorageService, and keeps context.
   */
  async recordIncomingUserImage(params: {
    chatId: string;
    ownerId: string;
    conversationId: string;
    imageUrl: string;
    externalMessageId?: string;
  }): Promise<RecentImageRecord | null> {
    try {
      this.logger.log(`[IMAGE_CONTEXT] Downloading incoming user image for chat ${params.chatId}`);

      const res = await axios.get(params.imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024, // 10MB max
      });

      const buffer = Buffer.from(res.data);
      const rawHeader = res.headers['content-type'];
      const contentType = typeof rawHeader === 'string' ? rawHeader : 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const objectKey = `user-inputs/${params.ownerId}/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;

      const storedFile = await this.storageService.saveFile({
        ownerId: params.ownerId,
        conversationId: params.conversationId,
        objectKey,
        buffer,
        mimeType: contentType,
        originalName: `zalo-input-${Date.now()}.${ext}`,
      });

      if (this.prisma?.storedFile?.update) {
        await this.prisma.storedFile.update({
          where: { id: storedFile.id },
          data: {
            conversationId: params.conversationId,
            source: 'incoming',
            originalMessageId: params.externalMessageId,
          },
        });
      }

      const record: RecentImageRecord = {
        fileId: storedFile.id,
        objectKey: storedFile.objectKey,
        mimeType: storedFile.mimeType,
        sourceUrl: params.imageUrl,
        timestamp: Date.now(),
      };

      this.recentInputs.set(params.chatId, record);
      this.logger.log(`[IMAGE_CONTEXT] Saved user input image #${storedFile.id} for chat ${params.chatId}`);
      return record;
    } catch (err: any) {
      this.logger.error(`[IMAGE_CONTEXT] Failed saving incoming user image: ${err.message}`);
      return null;
    }
  }

  /**
   * Records a newly generated/edited image by the bot for future reference in this chat.
   */
  recordOutputImage(chatId: string, record: RecentImageRecord) {
    this.recentOutputs.set(chatId, record);
  }

  /**
   * Resolves the best reference image for an image-to-image edit operation.
   * Priority:
   * 1. Explicit sourceFileId (scoped to owner).
   * 2. Most recent user input image in this chat (if within 1 hour).
   * 3. Most recent bot output image in this chat.
   */
  async resolveReferenceImage(params: {
    chatId: string;
    ownerId: string;
    sourceFileId?: string;
  }): Promise<{ fileId: string; buffer: Buffer; mimeType: string; objectKey: string; parentImageId?: string } | null> {
    // 1. Explicit fileId requested
    if (params.sourceFileId) {
      const fileData = await this.storageService.getFileBuffer(params.sourceFileId);
      if (!fileData) {
        throw new Error(`Không tìm thấy file ảnh với ID "${params.sourceFileId}".`);
      }
      if (fileData.file.ownerId && fileData.file.ownerId !== params.ownerId) {
        throw new Error('Bạn không có quyền truy cập file ảnh này.');
      }

      // Check if there's a corresponding GeneratedImage record
      const genRecord = await this.prisma.generatedImage.findUnique({
        where: { fileId: fileData.file.id },
      });

      return {
        fileId: fileData.file.id,
        buffer: fileData.buffer,
        mimeType: fileData.mimeType,
        objectKey: fileData.file.objectKey,
        parentImageId: genRecord?.id,
      };
    }

    // 2. Recent input image from user in this chat
    const recentInput = this.recentInputs.get(params.chatId);
    const oneHour = 60 * 60 * 1000;
    if (recentInput && Date.now() - recentInput.timestamp < oneHour) {
      const fileData = await this.storageService.getFileBuffer(recentInput.fileId);
      if (fileData) {
        return {
          fileId: recentInput.fileId,
          buffer: fileData.buffer,
          mimeType: fileData.mimeType,
          objectKey: recentInput.objectKey,
        };
      }
    }

    // 3. Recent output image generated in this chat
    const recentOutput = this.recentOutputs.get(params.chatId);
    if (recentOutput) {
      const fileData = await this.storageService.getFileBuffer(recentOutput.fileId);
      if (fileData) {
        return {
          fileId: recentOutput.fileId,
          buffer: fileData.buffer,
          mimeType: fileData.mimeType,
          objectKey: recentOutput.objectKey,
          parentImageId: recentOutput.imageId,
        };
      }
    }

    // 4. Fallback: Query database for the latest GeneratedImage in this conversation/owner
    const latestImage = await this.prisma.generatedImage.findFirst({
      where: { ownerId: params.ownerId },
      orderBy: { createdAt: 'desc' },
      include: { storedFile: true },
    });

    if (latestImage && latestImage.storedFile) {
      const fileData = await this.storageService.getFileBuffer(latestImage.storedFile.id);
      if (fileData) {
        return {
          fileId: latestImage.storedFile.id,
          buffer: fileData.buffer,
          mimeType: fileData.mimeType,
          objectKey: latestImage.storedFile.objectKey,
          parentImageId: latestImage.id,
        };
      }
    }

    return null;
  }

  /**
   * Retrieves active, non-expired media files for a conversation from the database.
   */
  async getRecentMedia(conversationId: string, limit = 5): Promise<any[]> {
    return this.prisma.storedFile.findMany({
      where: {
        conversationId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
