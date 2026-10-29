import { splitIntoChatMessages } from '../../src/modules/agent/message-splitter';

describe('splitIntoChatMessages', () => {
  it('should return empty array for empty or whitespace text', () => {
    expect(splitIntoChatMessages('')).toEqual([]);
    expect(splitIntoChatMessages('   \n\n  ')).toEqual([]);
  });

  it('should return single chunk if no paragraph breaks', () => {
    const text = 'Dạ hello anh/chị ạ! Em có thể giúp gì cho anh/chị?';
    expect(splitIntoChatMessages(text)).toEqual([text]);
  });

  it('should split distinct conversational paragraphs into separate messages', () => {
    const text =
      'Dạ hello anh/chị ạ! 😊 Em vừa mới tạo xong ảnh con mèo chibi dễ thương kia mà, anh/chị có thấy không?\n\n' +
      'Anh/chị có muốn em làm gì tiếp theo không ạ?';

    const result = splitIntoChatMessages(text);
    expect(result.length).toBe(2);
    expect(result[0]).toBe('Dạ hello anh/chị ạ! 😊 Em vừa mới tạo xong ảnh con mèo chibi dễ thương kia mà, anh/chị có thấy không?');
    expect(result[1]).toBe('Anh/chị có muốn em làm gì tiếp theo không ạ?');
  });

  it('should split empathetic opening from follow-up question', () => {
    const text =
      'Dạ, em hiểu anh/chị đang có cảm giác không vui rồi đây. Em xin lỗi và đồng cảm một chút nhé.\n\n' +
      'Anh/chị có muốn em lắng nghe hay giúp gì thêm không ạ? Em luôn ở đây để đồng hành cùng anh/chị.';

    const result = splitIntoChatMessages(text);
    expect(result.length).toBe(2);
    expect(result[0]).toContain('không vui rồi đây');
    expect(result[1]).toContain('lắng nghe hay giúp gì');
  });

  it('should keep introductory sentence ending with colon together with following list', () => {
    const text =
      'Dạ, em có thể chia sẻ một chút thông tin về ảnh con mèo chibi màu trắng vừa tạo xong nhé:\n\n' +
      '- **Nội dung:** Con mèo chibi màu trắng đang ngủ\n' +
      '- **Phong cách:** Chibi dễ thương\n\n' +
      'Anh/chị có muốn em tạo thêm ảnh nào khác không? 😊';

    const result = splitIntoChatMessages(text);
    expect(result.length).toBe(2);
    expect(result[0]).toContain('thông tin về ảnh');
    expect(result[0]).toContain('- **Nội dung:**');
    expect(result[1]).toBe('Anh/chị có muốn em tạo thêm ảnh nào khác không? 😊');
  });

  it('should preserve code blocks intact without splitting inside', () => {
    const text = 'Dạ đây là code mẫu:\n\n```typescript\nconst a = 1;\n\nconst b = 2;\n```\n\nAnh/chị xem thử nhé!';
    const result = splitIntoChatMessages(text);
    expect(result.length).toBe(1);
    expect(result[0]).toContain('```typescript');
  });

  it('should respect maxMessages limit by merging excess tail blocks', () => {
    const text = 'Đoạn 1 dài hơn 70 ký tự để không bị coi là micro-message test 1234567890.\n\n' +
                 'Đoạn 2 dài hơn 70 ký tự để không bị coi là micro-message test 1234567890.\n\n' +
                 'Đoạn 3 dài hơn 70 ký tự để không bị coi là micro-message test 1234567890.\n\n' +
                 'Đoạn 4 dài hơn 70 ký tự để không bị coi là micro-message test 1234567890.';

    const result = splitIntoChatMessages(text, 3);
    expect(result.length).toBe(3);
    expect(result[2]).toContain('Đoạn 3');
    expect(result[2]).toContain('Đoạn 4');
  });
});
