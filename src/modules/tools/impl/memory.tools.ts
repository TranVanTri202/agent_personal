import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MemorySaveTool implements AgentTool {
  name = 'memory_save';
  description = 'Lưu trữ một thông tin, sở thích hoặc ghi nhớ quan trọng của chủ sở hữu vào bộ nhớ dài hạn.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Nội dung cần ghi nhớ (ngắn gọn, chính xác)' },
      category: { type: 'string', description: 'Danh mục (vd: preferences, work, contact)' },
    },
    required: ['text'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { text: string; category?: string }, context: ToolExecutionContext): Promise<any> {
    const memory = await this.prisma.memory.create({
      data: {
        ownerId: context.ownerId,
        text: input.text,
        category: input.category || 'general',
      },
    });
    return {
      success: true,
      message: `Đã lưu vào bộ nhớ: "${memory.text}"`,
      id: memory.id,
    };
  }
}

@Injectable()
export class MemorySearchTool implements AgentTool {
  name = 'memory_search';
  description = 'Tìm kiếm các thông tin đã lưu trong bộ nhớ dài hạn của chủ sở hữu.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Từ khóa tìm kiếm' },
    },
    required: ['query'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { query: string }, context: ToolExecutionContext): Promise<any> {
    const memories = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        text: {
          contains: input.query,
          mode: 'insensitive',
        },
      },
      take: 5,
    });

    return {
      success: true,
      count: memories.length,
      memories: memories.map((m) => ({ id: m.id, category: m.category, text: m.text })),
    };
  }
}
