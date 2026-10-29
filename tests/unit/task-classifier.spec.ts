import { TaskClassifierService } from '../../src/modules/llm/routing/task-classifier.service';
import { LLMMessage } from '../../src/modules/llm/llm.types';

describe('TaskClassifierService', () => {
  let classifier: TaskClassifierService;

  beforeEach(() => {
    classifier = new TaskClassifierService();
  });

  it('should classify image attachments as image_understanding', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'Xem ảnh này giúp tôi' }];
    const result = classifier.classify(messages, false, true);

    expect(result.category).toBe('image_understanding');
  });

  it('should classify tool turn as tool_calling', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Tạo file excel' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'create_excel', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'tc1', content: '{"status":"ok"}' },
    ];
    const result = classifier.classify(messages, true);

    expect(result.category).toBe('tool_calling');
  });

  it('should classify gmail reading vs summary vs draft accurately', () => {
    const readMsgs: LLMMessage[] = [{ role: 'user', content: 'Kiểm tra hộp thư gmail hôm nay' }];
    expect(classifier.classify(readMsgs, false).category).toBe('gmail_read');

    const summaryMsgs: LLMMessage[] = [{ role: 'user', content: 'Tóm tắt các email quan trọng gần đây' }];
    expect(classifier.classify(summaryMsgs, false).category).toBe('gmail_summary');

    const draftMsgs: LLMMessage[] = [{ role: 'user', content: 'Soạn email trả lời khách hàng đối tác' }];
    expect(classifier.classify(draftMsgs, false).category).toBe('gmail_draft');
  });

  it('should classify coding and technical questions as coding', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'Giúp tôi fix bug đoạn code python này' }];
    expect(classifier.classify(messages, false).category).toBe('coding');
  });

  it('should classify planning and reasoning accurately', () => {
    const planMsgs: LLMMessage[] = [{ role: 'user', content: 'Lập kế hoạch triển khai marketing tuần tới' }];
    expect(classifier.classify(planMsgs, false).category).toBe('planning');

    const reasoningMsgs: LLMMessage[] = [{ role: 'user', content: 'Phân tích và giải thích tại sao hệ thống bị nghẽn' }];
    expect(classifier.classify(reasoningMsgs, false).category).toBe('general_reasoning');
  });

  it('should classify translation requests as translation', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'Dịch đoạn văn này sang tiếng Anh' }];
    expect(classifier.classify(messages, false).category).toBe('translation');
  });

  it('should default to chat for casual conversation', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'Xin chào, bạn khỏe không?' }];
    expect(classifier.classify(messages, false).category).toBe('chat');
  });
});
