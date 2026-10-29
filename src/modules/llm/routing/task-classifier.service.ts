import { Injectable } from '@nestjs/common';
import { LLMTaskCategory } from './task-category';
import { LLMMessage } from '../llm.types';

@Injectable()
export class TaskClassifierService {
  classify(
    messages: LLMMessage[],
    hasTools: boolean,
    hasImageAttachment?: boolean,
  ): { category: LLMTaskCategory; reason: string } {
    // 1. Check vision requirement
    if (hasImageAttachment) {
      return { category: 'image_understanding', reason: 'Yêu cầu có đính kèm hình ảnh' };
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const text = (lastUserMessage?.content || '').toLowerCase();

    // 2. Check tool calling stage
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'tool' || (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0)) {
      return { category: 'tool_calling', reason: 'Đang trong vòng lặp thực thi công cụ (tool-call turn)' };
    }

    // 3. Document operations
    if (text.includes('excel') || text.includes('xlsx') || text.includes('bảng tính')) {
      return { category: 'tool_calling', reason: 'Yêu cầu tạo hoặc thao tác bảng tính Excel' };
    }
    if (text.includes('pdf') || text.includes('word') || text.includes('docx') || text.includes('tài liệu')) {
      return { category: 'document_summary', reason: 'Thao tác liên quan tài liệu văn bản' };
    }

    // 4. Gmail operations
    if (text.includes('gmail') || text.includes('email') || text.includes('thư')) {
      if (text.includes('soạn') || text.includes('trả lời') || text.includes('draft') || text.includes('gửi')) {
        return { category: 'gmail_draft', reason: 'Soạn thảo hoặc tạo bản nháp email' };
      }
      if (text.includes('tóm tắt') || text.includes('tổng hợp') || text.includes('digest')) {
        return { category: 'gmail_summary', reason: 'Tóm tắt hộp thư hoặc email' };
      }
      return { category: 'gmail_read', reason: 'Đọc hoặc kiểm tra hộp thư email' };
    }

    // 5. Coding & scripts
    if (text.includes('code') || text.includes('lập trình') || text.includes('github') || text.includes('script') || text.includes('bug')) {
      return { category: 'coding', reason: 'Yêu cầu liên quan đến lập trình hoặc mã nguồn' };
    }

    // 6. Planning & general reasoning
    if (text.includes('kế hoạch') || text.includes('chiến lược') || text.includes('lập kế hoạch') || text.includes('các bước thực hiện')) {
      return { category: 'planning', reason: 'Yêu cầu phân rã mục tiêu hoặc lập kế hoạch' };
    }
    if (text.includes('tại sao') || text.includes('phân tích') || text.includes('so sánh') || text.includes('giải thích')) {
      return { category: 'general_reasoning', reason: 'Yêu cầu phân tích và suy luận chuyên sâu' };
    }

    // 7. Translation
    if (text.includes('dịch') || text.includes('translate') || text.includes('sang tiếng')) {
      return { category: 'translation', reason: 'Yêu cầu dịch thuật ngôn ngữ' };
    }

    // Default chat
    return { category: 'chat', reason: 'Hội thoại thông thường mặc định' };
  }
}
