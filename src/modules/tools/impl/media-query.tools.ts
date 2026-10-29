import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GetRecentMediaTool implements AgentTool<{ limit?: number }> {
  name = 'get_recent_media';
  description =
    'Liệt kê danh sách các hình ảnh và tệp tin gần nhất trong cuộc trò chuyện hiện tại, kèm thông tin thời gian tạo, hạn dùng 24h và trạng thái khả dụng.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Số lượng tệp cần lấy (mặc định 5, tối đa 10).',
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { limit?: number }, context: ToolExecutionContext): Promise<any> {
    const take = Math.min(10, Math.max(1, input.limit || 5));
    const now = new Date();

    const files = await this.prisma.storedFile.findMany({
      where: {
        conversationId: context.conversationId,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return {
      success: true,
      count: files.length,
      media: files.map((f) => ({
        mediaId: f.id,
        filename: f.originalName,
        mimeType: f.mimeType,
        source: f.source || 'incoming',
        status: f.status,
        isExpired: f.status === 'DELETED' || (f.expiresAt && f.expiresAt <= now),
        createdAt: f.createdAt,
        expiresAt: f.expiresAt,
        hasAnalysis: Boolean(f.analysisSummary),
      })),
    };
  }
}

@Injectable()
export class GetMediaMetadataTool implements AgentTool<{ mediaId: string }> {
  name = 'get_media_metadata';
  description =
    'Lấy thông tin chi tiết về siêu dữ liệu (metadata), hạn sử dụng 24h và kết quả phân tích đã lưu của một tệp tin/ảnh theo mediaId.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      mediaId: {
        type: 'string',
        description: 'Mã ID của tệp hoặc ảnh cần tra cứu metadata.',
      },
    },
    required: ['mediaId'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { mediaId: string }, context: ToolExecutionContext): Promise<any> {
    const file = await this.prisma.storedFile.findFirst({
      where: {
        OR: [{ id: input.mediaId }, { objectKey: input.mediaId }],
      },
    });

    if (!file) {
      return { success: false, error: 'NOT_FOUND', message: `Không tìm thấy media #${input.mediaId}` };
    }

    if (context.chatType === 'GROUP' && file.conversationId !== context.conversationId) {
      return { success: false, error: 'ACCESS_DENIED', message: 'Không thể truy cập metadata của tệp từ hội thoại khác.' };
    }

    const now = new Date();
    return {
      success: true,
      mediaId: file.id,
      filename: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      status: file.status,
      isExpired: file.status === 'DELETED' || (file.expiresAt && file.expiresAt <= now),
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      source: file.source,
      analysisSummary: file.analysisSummary || null,
      analysisModel: file.analysisModel || null,
      analysisCreatedAt: file.analysisCreatedAt || null,
    };
  }
}
