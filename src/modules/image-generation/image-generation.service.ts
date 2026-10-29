import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthService } from '../auth/auth.service';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { ImageCapabilityService } from './image-capability.service';
import { OpenRouterImageClient, ImageApiInputReference, ImageApiRequestPayload } from './openrouter-image.client';
import { ImageContextService } from './image-context.service';
import { EditImageDto, GenerateImageDto, ImageGenerationResult } from './dto/image-generation.dto';
import { ToolExecutionContext } from '../tools/tool.interface';

import sharp from 'sharp';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB

function detectMimeAndExt(buffer: Buffer, fallbackMime?: string): { mimeType: string; ext: string } {
  if (buffer.length >= 4) {
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { mimeType: 'image/png', ext: 'png' };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', ext: 'jpg' };
    }
    // WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { mimeType: 'image/webp', ext: 'webp' };
    }
  }

  if (fallbackMime?.includes('jpeg') || fallbackMime?.includes('jpg')) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (fallbackMime?.includes('webp')) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return { mimeType: 'image/png', ext: 'png' };
}

function getSharpInstance(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('sharp');
    return typeof mod === 'function' ? mod : mod?.default;
  } catch {
    return null;
  }
}

/**
 * Optimizes an image buffer specifically for Zalo Bot API delivery:
 * 1. Zalo has a strict 1MB limit for photos sent via sendPhoto API.
 * 2. Uncompressed RGBA PNGs or files > 1MB cause Zalo's image CDN crawler to fail,
 *    resulting in a black screen ("đen thui") on mobile/desktop clients.
 * 3. High-quality progressive JPEG (quality 90, mozjpeg) ensures crystal clear fidelity
 *    while staying comfortably well below the 1MB threshold.
 */
async function optimizeImageForZalo(
  inputBuffer: Buffer,
  fallbackMime?: string,
  logger?: AppLoggerService,
): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const initial = detectMimeAndExt(inputBuffer, fallbackMime);

  try {
    const sharpFn = getSharpInstance();
    if (!sharpFn) {
      logger?.warn('[IMAGE_OPTIMIZE] Sharp library is not available, skipping optimization.');
      return { buffer: inputBuffer, mimeType: initial.mimeType, ext: initial.ext };
    }

    if (inputBuffer.length > 800 * 1024 || initial.mimeType === 'image/png') {
      const optimized = await sharpFn(inputBuffer)
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();

      if (optimized.length > 950 * 1024) {
        const compressedMore = await sharpFn(inputBuffer)
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        logger?.log(
          `[IMAGE_OPTIMIZE] Compressed image from ${(inputBuffer.length / 1024).toFixed(1)}KB to ${(compressedMore.length / 1024).toFixed(1)}KB (JPEG 82)`,
        );
        return { buffer: compressedMore, mimeType: 'image/jpeg', ext: 'jpg' };
      }

      logger?.log(
        `[IMAGE_OPTIMIZE] Optimized image from ${(inputBuffer.length / 1024).toFixed(1)}KB to ${(optimized.length / 1024).toFixed(1)}KB (JPEG 90)`,
      );
      return { buffer: optimized, mimeType: 'image/jpeg', ext: 'jpg' };
    }
  } catch (err: any) {
    logger?.warn(`[IMAGE_OPTIMIZE_WARN] Sharp optimization failed: ${err.message}. Using original.`);
  }

  return { buffer: inputBuffer, mimeType: initial.mimeType, ext: initial.ext };
}

@Injectable()
export class ImageGenerationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly authService: AuthService,
    private readonly zaloClient: ZaloApiClient,
    private readonly capabilityService: ImageCapabilityService,
    private readonly imageClient: OpenRouterImageClient,
    private readonly imageContextService: ImageContextService,
    private readonly logger: AppLoggerService,
  ) {}

  private async assertOwnerPermission(ownerId: string): Promise<void> {
    const accessMode = this.configService.get<string>('BOT_ACCESS_MODE');
    if (accessMode === 'public') {
      return;
    }

    const isOwner = await this.authService.isOwner(ownerId);
    if (!isOwner) {
      throw new Error(
        'Bạn không có quyền thực hiện tạo ảnh trả phí. Chỉ chủ sở hữu (Owner) mới được cấp quyền sử dụng công cụ tạo/chỉnh sửa ảnh.',
      );
    }
  }

  private resolveGenerationModel(): string {
    const configured = this.configService.get<string>('OPENROUTER_IMAGE_MODEL')?.trim();
    return configured || 'qwen/qwen-image-2.1-turbo';
  }

  private resolveEditModel(): string {
    const configuredEdit = this.configService.get<string>('OPENROUTER_IMAGE_EDIT_MODEL')?.trim();
    if (configuredEdit) return configuredEdit;
    return this.resolveGenerationModel();
  }

  private async extractBufferFromResponseItem(item: { b64_json?: string; url?: string; media_type?: string }): Promise<Buffer> {
    if (item.b64_json) {
      const buf = Buffer.from(item.b64_json, 'base64');
      if (buf.length > MAX_IMAGE_BYTES) {
        throw new Error(`Dung lượng ảnh sinh ra (${(buf.length / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn an toàn 25MB.`);
      }
      return buf;
    }

    if (item.url) {
      this.logger.log(`[IMAGE_GEN] Downloading generated image from temporary URL...`);
      const res = await axios.get(item.url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: MAX_IMAGE_BYTES,
      });
      return Buffer.from(res.data);
    }

    throw new Error('OpenRouter Image API không trả về b64_json hoặc URL hợp lệ cho ảnh.');
  }

  async generateImage(input: GenerateImageDto, context: ToolExecutionContext): Promise<ImageGenerationResult> {
    await this.assertOwnerPermission(context.ownerId);

    const modelId = this.resolveGenerationModel();
    const { sanitized, warning } = await this.capabilityService.validateAndSanitizeParams(modelId, {
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      count: input.count,
      hasReference: false,
    });

    let prompt = input.prompt.trim();
    if (input.style) {
      prompt = `${prompt}, style: ${input.style}`;
    }

    const payload: ImageApiRequestPayload = {
      model: modelId,
      prompt,
      ...sanitized,
    };

    const apiResponse = await this.imageClient.callImageApi(payload);
    const items = apiResponse.data;

    let primaryResult: ImageGenerationResult | null = null;

    // Process each generated image
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rawBuffer = await this.extractBufferFromResponseItem(item);
      const { buffer, mimeType, ext } = await optimizeImageForZalo(rawBuffer, item.media_type, this.logger);

      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const objectKey = `outputs/images/${context.ownerId}/${Date.now()}-${randomSuffix}.${ext}`;

      const storedFile = await this.storageService.saveFile({
        ownerId: context.ownerId,
        taskId: context.taskId,
        objectKey,
        buffer,
        mimeType,
        originalName: `generated-${Date.now()}-${i + 1}.${ext}`,
      });

      const genImage = await this.prisma.generatedImage.create({
        data: {
          ownerId: context.ownerId,
          conversationId: context.conversationId || 'default',
          taskId: context.taskId,
          fileId: storedFile.id,
          prompt,
          modelId,
          actionType: 'generate',
          aspectRatio: sanitized.aspect_ratio || null,
          resolution: sanitized.resolution || null,
          costUsd: apiResponse.costUsd || null,
          status: 'SUCCESS',
        },
      });

      this.imageContextService.recordOutputImage(context.chatId, {
        fileId: storedFile.id,
        imageId: genImage.id,
        objectKey: storedFile.objectKey,
        mimeType: storedFile.mimeType,
        sourceUrl: item.url,
        timestamp: Date.now(),
      });

      const linkInfo = await this.storageService.getDownloadLink(storedFile.id);
      const deliveryUrl = linkInfo.url || (item.url?.startsWith('http') ? item.url : undefined);

      if (deliveryUrl) {
        try {
          const caption = items.length > 1 ? `Ảnh ${i + 1}/${items.length} (Model: ${modelId})` : `Ảnh tạo bởi ${modelId}`;
          await this.zaloClient.sendPhoto(context.chatId, deliveryUrl, caption);
          if (linkInfo.url) {
            await this.zaloClient.sendMessage(
              context.chatId,
              `🔗 Link xem/tải ảnh chất lượng cao (24h):\n${linkInfo.url}`,
            );
          }
        } catch (sendErr: any) {
          this.logger.warn(`[IMAGE_GEN] sendPhoto to Zalo failed: ${sendErr.message}`);
          await this.zaloClient.sendMessage(
            context.chatId,
            `⚠️ Em đã tạo xong ảnh #${i + 1} nhưng gửi trực tiếp qua Zalo gặp lỗi: ${sendErr.message}.\n${linkInfo.message || deliveryUrl}`,
          );
        }
      } else if (linkInfo.localPath) {
        await this.zaloClient.sendMessage(context.chatId, `🖼️ Đã lưu ảnh thành công vào máy tính:\n\`${linkInfo.localPath}\``);
      }

      if (i === 0) {
        primaryResult = {
          success: true,
          fileId: storedFile.id,
          imageId: genImage.id,
          url: deliveryUrl,
          localPath: linkInfo.localPath,
          storagePath: storedFile.objectKey,
          mimeType: storedFile.mimeType,
          costUsd: apiResponse.costUsd,
          modelId,
          actionType: 'generate',
          prompt,
          warning,
        };
      }
    }

    return (
      primaryResult || {
        success: false,
        modelId,
        actionType: 'generate',
        prompt,
        error: 'Không có ảnh nào được tạo.',
      }
    );
  }

  async editImage(input: EditImageDto, context: ToolExecutionContext): Promise<ImageGenerationResult> {
    await this.assertOwnerPermission(context.ownerId);

    const modelId = this.resolveEditModel();

    // 1. Resolve reference image
    const refImage = await this.imageContextService.resolveReferenceImage({
      chatId: context.chatId,
      ownerId: context.ownerId,
      sourceFileId: input.sourceFileId,
    });

    if (!refImage) {
      throw new Error(
        'Không tìm thấy ảnh tham chiếu để chỉnh sửa trong cuộc trò chuyện này. ' +
          'Vui lòng gửi ảnh kèm yêu cầu, hoặc chỉ định rõ ảnh cần sửa.',
      );
    }

    // 2. Validate capability
    const { sanitized, warning } = await this.capabilityService.validateAndSanitizeParams(modelId, {
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      count: input.count,
      hasReference: true,
    });

    // 3. Prepare base64 data URL for input_references
    const base64Str = refImage.buffer.toString('base64');
    const dataUrl = `data:${refImage.mimeType || 'image/jpeg'};base64,${base64Str}`;
    const inputReferences: ImageApiInputReference[] = [
      {
        type: 'image_url',
        image_url: {
          url: dataUrl,
        },
      },
    ];

    const payload: ImageApiRequestPayload = {
      model: modelId,
      prompt: input.prompt.trim(),
      input_references: inputReferences,
      ...sanitized,
    };

    const apiResponse = await this.imageClient.callImageApi(payload);
    const items = apiResponse.data;

    let primaryResult: ImageGenerationResult | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rawBuffer = await this.extractBufferFromResponseItem(item);
      const { buffer, mimeType, ext } = await optimizeImageForZalo(rawBuffer, item.media_type, this.logger);

      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const objectKey = `outputs/images/${context.ownerId}/edited-${Date.now()}-${randomSuffix}.${ext}`;

      const storedFile = await this.storageService.saveFile({
        ownerId: context.ownerId,
        taskId: context.taskId,
        objectKey,
        buffer,
        mimeType,
        originalName: `edited-${Date.now()}-${i + 1}.${ext}`,
      });

      const genImage = await this.prisma.generatedImage.create({
        data: {
          ownerId: context.ownerId,
          conversationId: context.conversationId || 'default',
          taskId: context.taskId,
          fileId: storedFile.id,
          parentImageId: refImage.parentImageId || null,
          prompt: input.prompt.trim(),
          modelId,
          actionType: 'edit',
          aspectRatio: sanitized.aspect_ratio || null,
          resolution: sanitized.resolution || null,
          costUsd: apiResponse.costUsd || null,
          status: 'SUCCESS',
        },
      });

      this.imageContextService.recordOutputImage(context.chatId, {
        fileId: storedFile.id,
        imageId: genImage.id,
        objectKey: storedFile.objectKey,
        mimeType: storedFile.mimeType,
        sourceUrl: item.url,
        timestamp: Date.now(),
      });

      const linkInfo = await this.storageService.getDownloadLink(storedFile.id);
      const deliveryUrl = linkInfo.url || (item.url?.startsWith('http') ? item.url : undefined);

      if (deliveryUrl) {
        try {
          const caption = `Ảnh chỉnh sửa theo yêu cầu (Model: ${modelId})`;
          await this.zaloClient.sendPhoto(context.chatId, deliveryUrl, caption);
          if (linkInfo.url) {
            await this.zaloClient.sendMessage(
              context.chatId,
              `🔗 Link xem/tải ảnh chất lượng cao (24h):\n${linkInfo.url}`,
            );
          }
        } catch (sendErr: any) {
          this.logger.warn(`[IMAGE_EDIT] sendPhoto to Zalo failed: ${sendErr.message}`);
          await this.zaloClient.sendMessage(
            context.chatId,
            `⚠️ Em đã chỉnh sửa xong ảnh nhưng gửi qua Zalo gặp lỗi: ${sendErr.message}.\n${linkInfo.message || deliveryUrl}`,
          );
        }
      } else if (linkInfo.localPath) {
        await this.zaloClient.sendMessage(context.chatId, `🖼️ Đã lưu ảnh chỉnh sửa vào máy tính:\n\`${linkInfo.localPath}\``);
      }

      if (i === 0) {
        primaryResult = {
          success: true,
          fileId: storedFile.id,
          imageId: genImage.id,
          url: deliveryUrl,
          localPath: linkInfo.localPath,
          storagePath: storedFile.objectKey,
          mimeType: storedFile.mimeType,
          costUsd: apiResponse.costUsd,
          modelId,
          actionType: 'edit',
          prompt: input.prompt.trim(),
          warning,
        };
      }
    }

    return (
      primaryResult || {
        success: false,
        modelId,
        actionType: 'edit',
        prompt: input.prompt,
        error: 'Không có ảnh nào được trả về.',
      }
    );
  }
}
