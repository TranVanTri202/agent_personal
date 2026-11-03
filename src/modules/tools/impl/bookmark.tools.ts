import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { SsrfValidator } from '../../../common/security/ssrf.validator';
import { FetchUrlTool, WebSearchTool } from './web.tools';

export interface BookmarkPayload {
  url?: string;
  title: string;
  summary: string;
  tags: string[];
  createdAt: string;
}

@Injectable()
export class BookmarkSaveTool implements AgentTool {
  name = 'save_bookmark';
  description =
    'Lưu đường link bài viết, trang web, tài liệu hoặc ghi chú nhanh vào kho "Second Brain / Đọc sau" (Bookmark) kèm tóm tắt nội dung và thẻ phân loại (#tags) để tra cứu lại bất cứ lúc nào.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Đường dẫn URL cần lưu (nếu có)',
      },
      title: {
        type: 'string',
        description: 'Tiêu đề ngắn gọn của link hoặc ghi chú',
      },
      summary: {
        type: 'string',
        description: 'Tóm tắt nội dung chính hoặc ghi chú (nếu để trống và có URL, hệ thống sẽ tự động đọc trang web)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Danh sách các thẻ phân loại (ví dụ: ["ai", "docker", "mua-sam", "cong-viec"])',
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: { url?: string; title?: string; summary?: string; tags?: string[] },
    context: ToolExecutionContext,
  ): Promise<any> {
    let title = (input.title || '').trim();
    let summary = (input.summary || '').trim();
    const url = (input.url || '').trim() || undefined;

    if (url && (!title || !summary)) {
      try {
        await SsrfValidator.assertSafeUrl(url);
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalZaloAgent/1.0)' },
          timeout: 10000,
          maxContentLength: 2 * 1024 * 1024,
          responseType: 'text',
        });
        const html = String(res.data || '');
        if (!title) {
          const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          title = m ? WebSearchTool.stripHtml(m[1]) : url;
        }
        if (!summary) {
          summary = FetchUrlTool.extractReadableText(html).slice(0, 600);
        }
      } catch {
        if (!title) title = url;
      }
    }

    if (!title && !summary && !url) {
      return { success: false, message: 'Vui lòng cung cấp URL hoặc nội dung ghi chú cần lưu.' };
    }

    const cleanTags = (input.tags || ['general']).map((t) =>
      t.toLowerCase().replace(/^#/, '').trim(),
    );

    const payload: BookmarkPayload = {
      url,
      title: title || summary.slice(0, 60) || 'Ghi chú nhanh',
      summary: summary || title,
      tags: cleanTags,
      createdAt: new Date().toISOString(),
    };

    const record = await this.prisma.memory.create({
      data: {
        ownerId: context.ownerId,
        category: 'bookmark_item',
        text: JSON.stringify(payload),
        importance: 3,
        source: context.conversationId,
      },
    });

    const tagStr = cleanTags.map((t) => `#${t}`).join(' ');
    return {
      success: true,
      bookmarkId: record.id,
      ...payload,
      message: `🔖 Đã lưu vào kho Bookmark (**${payload.title}** - ${tagStr}).`,
    };
  }
}

@Injectable()
export class BookmarkSearchTool implements AgentTool {
  name = 'search_bookmarks';
  description =
    'Tìm kiếm lại các đường link, bài viết, tài liệu hoặc ghi chú đã lưu trong kho Bookmark (Second Brain) theo từ khóa hoặc thẻ #tag.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Từ khóa tìm kiếm (tiêu đề, nội dung, domain hoặc #tag)',
      },
      tag: {
        type: 'string',
        description: 'Lọc theo thẻ tag cụ thể (tùy chọn)',
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { query?: string; tag?: string }, context: ToolExecutionContext): Promise<any> {
    const rawRecords = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        category: 'bookmark_item',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const q = (input.query || '').toLowerCase().trim();
    const targetTag = (input.tag || '').toLowerCase().replace(/^#/, '').trim();

    const items: Array<BookmarkPayload & { id: string }> = [];
    for (const r of rawRecords) {
      try {
        const parsed = JSON.parse(r.text) as BookmarkPayload;
        const matchesTag = !targetTag || (parsed.tags || []).includes(targetTag);
        const searchable = `${parsed.title} ${parsed.summary} ${parsed.url || ''} ${(parsed.tags || []).join(' ')}`.toLowerCase();
        const matchesQuery = !q || q.split(/\s+/).some((kw) => searchable.includes(kw));

        if (matchesTag && matchesQuery) {
          items.push({ id: r.id, ...parsed });
        }
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      count: items.length,
      bookmarks: items.slice(0, 10),
    };
  }
}
