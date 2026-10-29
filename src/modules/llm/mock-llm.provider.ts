import { Injectable } from '@nestjs/common';
import { LLMMessage, UnifiedLLMResponse, ToolCall, LLMProvider } from './llm.types';

@Injectable()
export class MockLLMProvider implements LLMProvider {
  private customResponseGenerator?: (messages: LLMMessage[], tools?: any[]) => Promise<UnifiedLLMResponse>;

  setCustomResponse(generator: (messages: LLMMessage[], tools?: any[]) => Promise<UnifiedLLMResponse>) {
    this.customResponseGenerator = generator;
  }

  reset() {
    this.customResponseGenerator = undefined;
  }

  isConfigured(): boolean {
    return true;
  }

  async chat(messages: LLMMessage[], tools?: any[], modelOverride?: string): Promise<UnifiedLLMResponse> {
    if (this.customResponseGenerator) {
      return this.customResponseGenerator(messages, tools);
    }

    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === 'tool') {
      const toolMessages = messages.filter((m) => m.role === 'tool');
      const toolNames = toolMessages.map((m) => m.name);

      if (toolNames.includes('resend_existing_media')) {
        const hasVisionFailure = toolMessages.some(
          (m) =>
            m.name === 'analyze_existing_image' &&
            Boolean(m.content && (m.content.includes('VISION_NOT_SUPPORTED') || m.content.includes('GATEWAY_NOT_CONFIGURED'))),
        );
        const reply = hasVisionFailure
          ? 'Dạ em đã gửi lại bức ảnh cho anh/chị rồi ạ! 🖼️ Tuy nhiên mô hình hiện tại không hỗ trợ phân tích hình ảnh nên em không thể đọc được nội dung trên ảnh ạ.'
          : 'Dạ em đã gửi lại bức ảnh cho anh/chị rồi ạ! 🖼️';

        return {
          requestedModel: modelOverride || 'mock-model',
          actualModel: modelOverride || 'mock-model',
          content: reply,
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90, costUsd: 0 },
          latencyMs: 10,
        };
      }

      return {
        requestedModel: modelOverride || 'mock-model',
        actualModel: modelOverride || 'mock-model',
        content: 'Tôi đã tạo thành công tài liệu theo yêu cầu của bạn!',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70, costUsd: 0 },
        latencyMs: 10,
      };
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const text = (lastUserMessage?.content || '').toLowerCase();

    // Check if input references an existing image with multi-intent (analyze + resend)
    const isImageQuery = text.includes('ảnh') || text.includes('hình') || text.includes('anh') || text.includes('hinh');
    const isResendReq = text.includes('gửi lại') || text.includes('gửi') || text.includes('gui lai') || text.includes('gui');
    const isAnalyzeReq = text.includes('thông tin gì') || text.includes('có gì') || text.includes('phân tích') || text.includes('thong tin');

    if ((isImageQuery || isResendReq) && tools && tools.some((t: any) => t.function?.name === 'resend_existing_media')) {
      const toolCalls: ToolCall[] = [];

      // Extract resolved media ID from injected system prompt if present
      const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
      const idMatch = systemMsg.match(/Media\/File ID:\s*"([^"]+)"/);
      const mediaId = idMatch ? idMatch[1] : undefined;

      if (isAnalyzeReq) {
        toolCalls.push({
          id: `call_analyze_${Date.now()}`,
          name: 'analyze_existing_image',
          arguments: { mediaId, query: text },
        });
      }

      if (isResendReq || text.includes('gửi')) {
        toolCalls.push({
          id: `call_resend_${Date.now()}`,
          name: 'resend_existing_media',
          arguments: { mediaId: mediaId || 'last_image' },
        });
      }

      if (toolCalls.length > 0) {
        return {
          requestedModel: modelOverride || 'mock-model',
          actualModel: modelOverride || 'mock-model',
          content: null,
          toolCalls,
          finishReason: 'tool_calls',
          usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120, costUsd: 0 },
          latencyMs: 12,
        };
      }
    }

    // Check if input requests an Excel file
    if (text.includes('excel') || text.includes('xlsx')) {
      const toolCalls: ToolCall[] = [
        {
          id: `call_${Date.now()}`,
          name: 'create_excel',
          arguments: {
            filename: 'cong_viec.xlsx',
            columns: [
              { header: 'Công việc', key: 'task' },
              { header: 'Trạng thái', key: 'status' },
            ],
            rows: [
              { task: 'Hoàn thành tích hợp Zalo Bot', status: 'Đang làm' },
              { task: 'Cấu hình OpenAI / OpenRouter API', status: 'Cần thiết' },
            ],
          },
        },
      ];
      return {
        requestedModel: modelOverride || 'mock-model',
        actualModel: modelOverride || 'mock-model',
        content: null,
        toolCalls,
        finishReason: 'tool_calls',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0 },
        latencyMs: 15,
      };
    }

    // Default polite response
    return {
      requestedModel: modelOverride || 'mock-model',
      actualModel: modelOverride || 'mock-model',
      content:
        'Xin chào! Tôi là Trợ lý AI cá nhân của bạn qua Zalo. Bạn có thể yêu cầu tôi tạo tài liệu Excel/PDF/Word, đặt lịch nhắc việc, hoặc quản lý tác vụ.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70, costUsd: 0 },
      latencyMs: 5,
    };
  }
}
