import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ZaloApiClient } from '../../zalo/zalo-api.client';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

export interface ResendMediaDto {
  mediaId: string;
  caption?: string;
}

@Injectable()
export class ResendExistingMediaTool implements AgentTool<ResendMediaDto> {
  name = 'resend_existing_media';
  description =
    'Gửi lại một hình ảnh hoặc tệp tin đã có sẵn trong cuộc trò chuyện (mediaId hoặc fileId) trực tiếp về Zalo chat. ' +
    'Tự động kiểm tra tính khả dụng, quyền truy cập và thời hạn lưu trữ 24 giờ của tệp.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      mediaId: {
        type: 'string',
        description: 'Mã ID của hình ảnh hoặc tệp tin cần gửi lại (mediaId hoặc fileId).',
      },
      caption: {
        type: 'string',
        description: 'Lời nhắn hoặc chú thích kèm theo khi gửi lại ảnh (tùy chọn).',
      },
    },
    required: ['mediaId'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly zaloClient: ZaloApiClient,
    private readonly logger: AppLoggerService,
  ) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: ResendMediaDto, context: ToolExecutionContext): Promise<any> {
    const fileId = input.mediaId?.trim();
    if (!fileId) {
      return { success: false, error: 'MISSING_MEDIA_ID', message: 'Vui lòng cung cấp mediaId cần gửi lại.' };
    }

    // 1. Look up file in PostgreSQL
    const file = await this.prisma.storedFile.findFirst({
      where: {
        OR: [{ id: fileId }, { objectKey: fileId }],
      },
    });

    if (!file) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: `Không tìm thấy hình ảnh hoặc tệp tin với ID "${fileId}" trong hệ thống.`,
      };
    }

    // 2. Expiration and deletion check (24h TTL)
    const now = new Date();
    if (file.status === 'DELETED' || file.status === 'DELETING' || (file.expiresAt && file.expiresAt <= now)) {
      return {
        success: false,
        isExpired: true,
        error: 'EXPIRED',
        message: '⚠️ Tệp tin/hình ảnh này đã hết hạn lưu trữ tạm (24 giờ) và đã được xóa tự động khỏi hệ thống.',
      };
    }

    // 3. Security Scope Check
    // If request originates from a GROUP chat, the file MUST belong to this group conversation
    if (context.chatType === 'GROUP' && file.conversationId !== context.conversationId) {
      this.logger.warn(
        `[SECURITY_DENIED] Blocked group access to file #${file.id} belonging to conv ${file.conversationId}`,
      );
      return {
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Bạn không có quyền truy cập hoặc gửi tệp tin riêng tư này vào nhóm chat.',
      };
    }

    // 4. Generate fresh signed URL
    const dl = await this.storageService.getDownloadLink(file.id);
    if (!dl.url) {
      return {
        success: false,
        error: 'URL_GENERATION_FAILED',
        message: dl.message || 'Không thể tạo liên kết truy xuất tệp tin.',
      };
    }

    // 5. Send via Zalo SDK based on MIME type
    try {
      if (file.mimeType.startsWith('image/')) {
        const photoCaption = input.caption || `📸 Ảnh gửi lại: ${file.originalName}`;
        const sendRes = await this.zaloClient.sendPhoto(context.chatId, dl.url, photoCaption);
        this.logger.log(`[MEDIA_RESEND_SUCCESS] Resent image #${file.id} to chat ${context.chatId}`);
        return {
          success: true,
          mediaId: file.id,
          filename: file.originalName,
          mimeType: file.mimeType,
          zaloResult: sendRes,
          message: `Dạ em đã gửi lại bức ảnh cho anh/chị rồi ạ! 🖼️`,
        };
      } else {
        await this.zaloClient.sendFileLink(context.chatId, dl.url, file.originalName);
        this.logger.log(`[MEDIA_RESEND_SUCCESS] Resent document #${file.id} to chat ${context.chatId}`);
        return {
          success: true,
          mediaId: file.id,
          filename: file.originalName,
          mimeType: file.mimeType,
          message: `Dạ em đã gửi lại liên kết tải tệp "${file.originalName}" cho anh/chị rồi ạ! 📎`,
        };
      }
    } catch (err: any) {
      this.logger.error(`[MEDIA_RESEND_ERROR] Failed sending media to Zalo: ${err.message}`);
      return {
        success: false,
        error: 'DELIVERY_FAILED',
        message: `Lỗi khi gửi tệp tin qua Zalo API: ${err.message}`,
      };
    }
  }
}
