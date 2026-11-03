import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { SsrfValidator } from '../../../common/security/ssrf.validator';
import { OpenRouterClientProvider } from '../../llm/openrouter/openrouter.client';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

@Injectable()
export class WebSearchTool implements AgentTool {
  name = 'web_search';
  description =
    'Tìm kiếm thông tin thời gian thực trên Internet (tin tức mới nhất, giá vàng, tỷ giá, thời tiết, sự kiện, tài liệu kỹ thuật, tra cứu thông tin thực tế).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Câu truy vấn tìm kiếm (nên ngắn gọn, rõ từ khóa chính)',
      },
      maxResults: {
        type: 'number',
        description: 'Số lượng kết quả tối đa (mặc định 5, tối đa 10)',
      },
    },
    required: ['query'],
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly openRouterClient: OpenRouterClientProvider,
    private readonly logger: AppLoggerService,
  ) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { query: string; maxResults?: number }, _context: ToolExecutionContext): Promise<any> {
    const query = (input.query || '').trim();
    if (!query) {
      return { success: false, message: 'Từ khóa tìm kiếm không được để trống.' };
    }

    const maxResults = Math.min(10, Math.max(1, input.maxResults || 5));

    // 1. If Tavily API Key is configured in WEB_SEARCH_API_KEY, use Tavily Search API
    const tavilyKey = this.configService.get<string>('WEB_SEARCH_API_KEY');
    if (tavilyKey && tavilyKey.trim().length > 0) {
      try {
        const tavilyRes = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: tavilyKey.trim(),
            query,
            max_results: maxResults,
            include_answer: true,
          },
          { timeout: 15000 },
        );
        const results: WebSearchResultItem[] = (tavilyRes.data?.results || []).map((r: any) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.content || '',
        }));
        return {
          success: true,
          engine: 'tavily',
          query,
          answer: tavilyRes.data?.answer,
          results,
        };
      } catch (err: any) {
        this.logger.warn(`[WEB_SEARCH] Tavily search failed, falling back: ${err.message}`);
      }
    }

    // 2. Try DuckDuckGo HTML Search
    try {
      const ddgResults = await this.searchDuckDuckGo(query, maxResults);
      if (ddgResults.length > 0) {
        return {
          success: true,
          engine: 'duckduckgo',
          query,
          count: ddgResults.length,
          results: ddgResults,
        };
      }
    } catch (err: any) {
      this.logger.warn(`[WEB_SEARCH] DuckDuckGo search failed: ${err.message}`);
    }

    // 3. Fallback to OpenRouter :online Web Search plugin if OpenRouter is configured
    if (this.openRouterClient.isConfigured()) {
      try {
        const client = this.openRouterClient.getClient();
        const model = this.configService.get<string>('LLM_SINGLE_MODEL') || 'openai/gpt-4o-mini';
        const onlineModel = model.endsWith(':online') ? model : `${model}:online`;

        const completion = await client.chat.completions.create({
          model: onlineModel,
          messages: [
            {
              role: 'system',
              content:
                'Hãy tìm kiếm thông tin mới nhất trên web cho truy vấn của người dùng và trả về tóm tắt chi tiết kèm nguồn URL.',
            },
            { role: 'user', content: query },
          ],
          max_tokens: 1024,
        } as any);

        const content = completion.choices[0]?.message?.content || '';
        return {
          success: true,
          engine: 'openrouter_online',
          query,
          answer: content,
          results: [],
        };
      } catch (err: any) {
        this.logger.warn(`[WEB_SEARCH] OpenRouter online search fallback failed: ${err.message}`);
      }
    }

    return {
      success: false,
      query,
      message: 'Không thể truy xuất kết quả tìm kiếm web lúc này.',
    };
  }

  private async searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResultItem[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 12000,
    });

    const html = String(res.data || '');
    const results: WebSearchResultItem[] = [];

    // Match result blocks in DuckDuckGo HTML
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      let rawHref = match[1];
      const uddgMatch = rawHref.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        rawHref = decodeURIComponent(uddgMatch[1]);
      }
      const cleanTitle = WebSearchTool.stripHtml(match[2]);
      if (rawHref.startsWith('http') && cleanTitle) {
        links.push({ url: rawHref, title: cleanTitle });
      }
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(WebSearchTool.stripHtml(match[1]));
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
      });
    }

    return results;
  }

  static stripHtml(raw: string): string {
    return raw
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

@Injectable()
export class FetchUrlTool implements AgentTool {
  name = 'fetch_url';
  description =
    'Đọc và trích xuất nội dung văn bản từ một đường link URL (bài báo, trang web, blog, tài liệu trực tuyến) mà người dùng gửi hoặc cần tìm hiểu sâu. Có bảo vệ chống SSRF an toàn.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Đường dẫn URL đầy đủ bắt đầu bằng http:// hoặc https://',
      },
      maxChars: {
        type: 'number',
        description: 'Số ký tự tối đa cần trích xuất (mặc định 10000)',
      },
    },
    required: ['url'],
  };

  constructor(private readonly logger: AppLoggerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { url: string; maxChars?: number }, _context: ToolExecutionContext): Promise<any> {
    const url = (input.url || '').trim();
    if (!url) {
      return { success: false, message: 'URL không được để trống.' };
    }

    try {
      // 1. SSRF Security Check
      await SsrfValidator.assertSafeUrl(url);

      // 2. Fetch page content
      const res = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; PersonalZaloAgent/1.0; +https://zalo.me)',
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        },
        timeout: 15000,
        maxContentLength: 5 * 1024 * 1024, // 5MB max
        responseType: 'text',
      });

      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      const rawBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
      const maxChars = Math.min(25000, Math.max(1000, input.maxChars || 10000));

      if (contentType.includes('application/json') || contentType.includes('text/plain')) {
        return {
          success: true,
          url,
          contentType,
          content: rawBody.slice(0, maxChars),
          truncated: rawBody.length > maxChars,
        };
      }

      // Extract HTML title and readable text
      const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? WebSearchTool.stripHtml(titleMatch[1]) : '';

      const cleanedText = FetchUrlTool.extractReadableText(rawBody);

      return {
        success: true,
        url,
        title,
        contentType,
        content: cleanedText.slice(0, maxChars),
        length: cleanedText.length,
        truncated: cleanedText.length > maxChars,
      };
    } catch (err: any) {
      this.logger.warn(`[FETCH_URL_ERROR] Failed reading ${url}: ${err.message}`);
      return {
        success: false,
        url,
        message: `Không thể đọc nội dung từ URL (${err.message}).`,
      };
    }
  }

  static extractReadableText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(?:nav|footer|header|aside)[\s\S]*?<\/(?:nav|footer|header|aside)>/gi, ' ')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|article|section|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;|&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();
  }
}
