import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OpenRouterModelCatalogService } from '../../llm/openrouter/openrouter.catalog';
import { OpenRouterClientProvider } from '../../llm/openrouter/openrouter.client';
import { LLMRoutingService } from '../../llm/routing/llm-routing.service';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

export interface AnalyzeExistingImageDto {
  mediaId?: string;
  query?: string;
}

@Injectable()
export class AnalyzeExistingImageTool implements AgentTool<AnalyzeExistingImageDto> {
  name = 'analyze_existing_image';
  description =
    'Phân tích nội dung chi tiết, trích xuất văn bản (OCR) và giải thích thông tin trong hình ảnh đã có sẵn trong cuộc trò chuyện (mediaId). ' +
    'Nếu không truyền mediaId, tool sẽ tự động tìm bức ảnh gần nhất trong hội thoại.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      mediaId: {
        type: 'string',
        description: 'Mã ID của bức ảnh cần phân tích (tùy chọn, để trống sẽ tự lấy ảnh gần nhất).',
      },
      query: {
        type: 'string',
        description: 'Câu hỏi hoặc yêu cầu phân tích cụ thể (ví dụ: "ảnh này có thông tin gì", "trích xuất chữ trong ảnh").',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly openRouterCatalog: OpenRouterModelCatalogService,
    private readonly openRouterClientProvider: OpenRouterClientProvider,
    private readonly routingService: LLMRoutingService,
    private readonly logger: AppLoggerService,
  ) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: AnalyzeExistingImageDto, context: ToolExecutionContext): Promise<any> {
    let fileId = input.mediaId?.trim();

    // 1. Resolve mediaId if not explicitly provided
    if (!fileId) {
      const state = await this.prisma.conversationState.findUnique({
        where: { conversationId: context.conversationId },
      });
      const lastImageIds = Array.isArray(state?.lastImageIds) ? (state.lastImageIds as string[]) : [];
      if (lastImageIds.length > 0) {
        fileId = lastImageIds[0];
      } else {
        const recent = await this.prisma.storedFile.findFirst({
          where: {
            conversationId: context.conversationId,
            mimeType: { startsWith: 'image/' },
            status: 'ACTIVE',
          },
          orderBy: { createdAt: 'desc' },
        });
        if (recent) {
          fileId = recent.id;
        }
      }
    }

    if (!fileId) {
      return {
        success: false,
        error: 'NO_IMAGE',
        message: 'Không tìm thấy hình ảnh nào trong cuộc trò chuyện này để phân tích.',
      };
    }

    // 2. Fetch StoredFile record
    const file = await this.prisma.storedFile.findFirst({
      where: {
        OR: [{ id: fileId }, { objectKey: fileId }],
      },
    });

    if (!file) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: `Không tìm thấy hình ảnh với ID "${fileId}" trong hệ thống.`,
      };
    }

    // 3. Expiry and Status Check (24h TTL)
    const now = new Date();
    if (file.status === 'DELETED' || file.status === 'DELETING' || (file.expiresAt && file.expiresAt <= now)) {
      return {
        success: false,
        isExpired: true,
        error: 'EXPIRED',
        message: '⚠️ Bức ảnh này đã hết hạn lưu trữ tạm (24 giờ) và đã được xóa khỏi hệ thống.',
      };
    }

    // 4. Security Scope Check
    if (context.chatType === 'GROUP' && file.conversationId !== context.conversationId) {
      return {
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Bạn không có quyền phân tích hình ảnh từ cuộc trò chuyện khác.',
      };
    }

    // 5. Check cached analysis summary
    if (!input.query && file.analysisSummary) {
      this.logger.log(`[IMAGE_ANALYSIS] Returning cached analysis for media #${file.id}`);
      return {
        success: true,
        mediaId: file.id,
        filename: file.originalName,
        isCached: true,
        summary: file.analysisSummary,
        model: file.analysisModel,
      };
    }

    // 6. Resolve Vision model
    const resolvedModel = await this.routingService.resolveModel({
      category: 'image_understanding',
      requiresVision: true,
      ownerId: context.ownerId,
      conversationId: context.conversationId,
    });

    const isVisionSupported = await this.openRouterCatalog.supportsVision(resolvedModel.modelId);

    if (!isVisionSupported) {
      this.logger.warn(
        `[IMAGE_ANALYSIS] Model "${resolvedModel.modelId}" does not support vision capabilities. Reporting truthfully.`,
      );
      return {
        success: false,
        isVisionSupported: false,
        error: 'VISION_NOT_SUPPORTED',
        mediaId: file.id,
        filename: file.originalName,
        model: resolvedModel.modelId,
        message: `Mô hình AI hiện tại ("${resolvedModel.modelId}") không hỗ trợ xử lý thị giác (Vision) để đọc nội dung ảnh. Vui lòng chuyển sang mô hình có hỗ trợ hình ảnh (ví dụ: openai/gpt-4o-mini hoặc google/gemini-flash-1.5).`,
      };
    }

    // 7. Get fresh download link for OpenRouter Vision
    const dl = await this.storageService.getDownloadLink(file.id);
    if (!dl.url) {
      return {
        success: false,
        error: 'URL_FAILED',
        message: 'Không thể tạo URL ảnh để phân tích.',
      };
    }

    // 8. Execute Vision Request via OpenRouter Client
    if (!this.openRouterClientProvider.isConfigured()) {
      return {
        success: false,
        isVisionSupported: false,
        error: 'GATEWAY_NOT_CONFIGURED',
        mediaId: file.id,
        filename: file.originalName,
        message: 'OpenRouter API Key chưa được cấu hình cho tính năng phân tích hình ảnh.',
      };
    }

    try {
      const client = this.openRouterClientProvider.getClient();
      const promptText =
        input.query ||
        'Hãy phân tích chi tiết nội dung bức ảnh này, trích xuất tất cả chữ viết (OCR) và các thông tin quan trọng hiển thị trên ảnh.';

      const completion = await client.chat.completions.create({
        model: resolvedModel.modelId,
        messages: [
          {
            role: 'system',
            content:
              'Bạn là chuyên gia phân tích hình ảnh và trích xuất thông tin (OCR). ' +
              'Hãy mô tả trung thực, chính xác các chi tiết, văn bản hiển thị và thông tin trong ảnh. ' +
              'Tuyệt đối không suy đoán hay bịa đặt thông tin không có trên hình ảnh.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image_url', image_url: { url: dl.url } },
            ] as any,
          },
        ],
        max_tokens: 1000,
      });

      const summary = completion.choices[0]?.message?.content || 'Không thể trích xuất nội dung từ ảnh.';

      // Save analysis summary on StoredFile for future turn caching
      await this.prisma.storedFile.update({
        where: { id: file.id },
        data: {
          analysisSummary: summary,
          analysisModel: resolvedModel.modelId,
          analysisCreatedAt: new Date(),
        },
      });

      this.logger.log(`[IMAGE_ANALYSIS_SUCCESS] Analyzed image #${file.id} using model ${resolvedModel.modelId}`);

      return {
        success: true,
        mediaId: file.id,
        filename: file.originalName,
        summary,
        model: resolvedModel.modelId,
      };
    } catch (err: any) {
      this.logger.error(`[IMAGE_ANALYSIS_ERROR] Failed analyzing image: ${err.message}`);
      return {
        success: false,
        error: 'ANALYSIS_FAILED',
        message: `Lỗi khi gọi mô hình Vision: ${err.message}`,
      };
    }
  }
}
