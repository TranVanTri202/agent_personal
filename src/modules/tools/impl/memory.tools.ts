import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MemorySaveTool implements AgentTool {
  name = 'memory_save';
  description =
    'Lưu trữ một thông tin cá nhân, sở thích, thói quen, mối quan hệ, dị ứng, công việc hoặc ghi nhớ quan trọng của chủ sở hữu vào bộ nhớ dài hạn (Long-term Memory). Hãy chủ động gọi công cụ này khi người dùng chia sẻ thông tin cá nhân cần nhớ lâu dài.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Nội dung cần ghi nhớ (ngắn gọn, rõ ràng, ví dụ: "Anh Trí bị dị ứng hải sản", "Email công ty là tri@company.com")',
      },
      category: {
        type: 'string',
        enum: ['preferences', 'personal', 'work', 'contact', 'health', 'general'],
        description: 'Danh mục phân loại (preferences, personal, work, contact, health, general)',
      },
      importance: {
        type: 'number',
        description: 'Mức độ quan trọng từ 1 (thấp) đến 5 (rất quan trọng, mặc định 3)',
      },
    },
    required: ['text'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: { text: string; category?: string; importance?: number },
    context: ToolExecutionContext,
  ): Promise<any> {
    const cleanText = (input.text || '').trim();
    if (!cleanText) {
      return { success: false, message: 'Nội dung ghi nhớ không được để trống.' };
    }

    const category = input.category || 'general';
    const importance = Math.min(5, Math.max(1, Math.round(input.importance ?? 3)));

    // Check if an identical memory already exists for this owner to avoid duplicates
    const existing = await this.prisma.memory.findFirst({
      where: {
        ownerId: context.ownerId,
        text: { equals: cleanText, mode: 'insensitive' },
      },
    });

    if (existing) {
      const updated = await this.prisma.memory.update({
        where: { id: existing.id },
        data: {
          category,
          importance: Math.max(existing.importance, importance),
        },
      });
      return {
        success: true,
        updated: true,
        message: `Đã cập nhật ghi nhớ trong bộ nhớ dài hạn: "${updated.text}" [${updated.category}]`,
        id: updated.id,
      };
    }

    const memory = await this.prisma.memory.create({
      data: {
        ownerId: context.ownerId,
        text: cleanText,
        category,
        importance,
        source: context.conversationId,
      },
    });

    return {
      success: true,
      message: `Đã lưu vào bộ nhớ dài hạn: "${memory.text}" (Danh mục: ${memory.category}, Độ quan trọng: ${memory.importance}/5)`,
      id: memory.id,
    };
  }
}

@Injectable()
export class MemorySearchTool implements AgentTool {
  name = 'memory_search';
  description =
    'Tìm kiếm thông tin cá nhân, sở thích, thói quen, liên hệ đã lưu trong bộ nhớ dài hạn của chủ sở hữu (hỗ trợ tìm kiếm đa từ khóa và theo danh mục).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Từ khóa hoặc câu hỏi cần tìm kiếm trong bộ nhớ' },
      category: {
        type: 'string',
        description: 'Lọc theo danh mục tùy chọn (preferences, personal, work, contact, health, general)',
      },
    },
    required: ['query'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { query: string; category?: string }, context: ToolExecutionContext): Promise<any> {
    const allMemories = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        ...(input.category ? { category: input.category } : {}),
      },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });

    const rawQuery = (input.query || '').trim().toLowerCase();
    const keywords = rawQuery
      .split(/[\s,.;?!]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);

    if (keywords.length === 0) {
      const top = allMemories.slice(0, 10);
      return {
        success: true,
        count: top.length,
        memories: top.map((m) => ({
          id: m.id,
          category: m.category,
          importance: m.importance,
          text: m.text,
        })),
      };
    }

    // Score each memory by keyword overlap + phrase match + importance
    const scored = allMemories
      .map((m) => {
        const lowerText = m.text.toLowerCase();
        const lowerCat = m.category.toLowerCase();
        let score = 0;

        if (lowerText.includes(rawQuery)) {
          score += 10;
        }
        for (const kw of keywords) {
          if (lowerText.includes(kw)) score += 3;
          if (lowerCat.includes(kw)) score += 2;
        }
        if (score > 0) {
          score += m.importance * 0.5;
        }
        return { memory: m, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const results = scored.map((s) => s.memory);

    return {
      success: true,
      count: results.length,
      memories: results.map((m) => ({
        id: m.id,
        category: m.category,
        importance: m.importance,
        text: m.text,
      })),
    };
  }
}

@Injectable()
export class MemoryDeleteTool implements AgentTool {
  name = 'memory_delete';
  description = 'Xóa một thông tin ghi nhớ cũ hoặc không còn chính xác khỏi bộ nhớ dài hạn của chủ sở hữu.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: 'ID hoặc 8 ký tự đầu của ID bộ nhớ cần xóa' },
      keyword: { type: 'string', description: 'Hoặc từ khóa nội dung bộ nhớ cần xóa nếu không rõ ID' },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { memoryId?: string; keyword?: string }, context: ToolExecutionContext): Promise<any> {
    if (!input.memoryId && !input.keyword) {
      return { success: false, message: 'Vui lòng cung cấp memoryId hoặc keyword để xóa bộ nhớ.' };
    }

    const candidates = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        ...(input.memoryId
          ? { id: { startsWith: input.memoryId.trim() } }
          : { text: { contains: input.keyword!.trim(), mode: 'insensitive' } }),
      },
    });

    if (candidates.length === 0) {
      return { success: false, message: 'Không tìm thấy ghi nhớ phù hợp để xóa.' };
    }

    const target = candidates[0];
    await this.prisma.memory.delete({ where: { id: target.id } });

    return {
      success: true,
      deletedId: target.id,
      deletedText: target.text,
      message: `Đã xóa ghi nhớ khỏi bộ nhớ dài hạn: "${target.text}"`,
    };
  }
}
