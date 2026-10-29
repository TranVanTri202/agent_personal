import { ZaloEventNormalizer } from '../../src/modules/zalo/zalo-event.normalizer';

describe('ZaloEventNormalizer', () => {
  let normalizer: ZaloEventNormalizer;

  beforeEach(() => {
    normalizer = new ZaloEventNormalizer();
  });

  it('should normalize text message event correctly', () => {
    const raw = {
      event_name: 'message.text.received',
      message: {
        message_id: 'msg-001',
        date: 1750316131602,
        message_type: 'CHAT_TEXT',
        from: { id: 'user-001', display_name: 'Nguyen Van A', is_bot: false },
        chat: { id: 'chat-001', chat_type: 'PRIVATE' },
        text: 'Xin chào AI Agent',
      },
    };

    const result = normalizer.normalize(raw);
    expect(result).not.toBeNull();
    expect(result?.channel).toBe('ZALO_OFFICIAL_BOT');
    expect(result?.externalMessageId).toBe('msg-001');
    expect(result?.senderId).toBe('user-001');
    expect(result?.senderName).toBe('Nguyen Van A');
    expect(result?.chatId).toBe('chat-001');
    expect(result?.chatType).toBe('PRIVATE');
    expect(result?.type).toBe('TEXT');
    expect(result?.text).toBe('Xin chào AI Agent');
  });

  it('should normalize image message event with photo_url', () => {
    const raw = {
      event_name: 'message.image.received',
      message: {
        message_id: 'msg-img-001',
        date: 1750316131602,
        from: { id: 'user-001' },
        chat: { id: 'chat-001', chat_type: 'PRIVATE' },
        photo_url: 'https://example.com/photo.jpg',
        caption: 'Xem hình này giúp tôi',
      },
    };

    const result = normalizer.normalize(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('IMAGE');
    expect(result?.caption).toBe('Xem hình này giúp tôi');
    expect(result?.attachments).toHaveLength(1);
    expect(result?.attachments[0].sourceUrl).toBe('https://example.com/photo.jpg');
  });

  it('should normalize voice message event with voice_url', () => {
    const raw = {
      event_name: 'message.voice.received',
      message: {
        message_id: 'msg-voice-001',
        date: 1750316131602,
        from: { id: 'user-001' },
        chat: { id: 'chat-001', chat_type: 'PRIVATE' },
        voice_url: 'https://example.com/audio.aac',
      },
    };

    const result = normalizer.normalize(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('VOICE');
    expect(result?.attachments[0].sourceUrl).toBe('https://example.com/audio.aac');
  });

  it('should handle unsupported message gracefully', () => {
    const raw = {
      event_name: 'message.unsupported.received',
      message: {
        message_id: 'msg-unsup-001',
        from: { id: 'user-001' },
        chat: { id: 'chat-001', chat_type: 'PRIVATE' },
      },
    };

    const result = normalizer.normalize(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('UNSUPPORTED');
  });

  it('should return null for invalid or missing message payload', () => {
    expect(normalizer.normalize(null)).toBeNull();
    expect(normalizer.normalize({})).toBeNull();
    expect(normalizer.normalize({ event_name: 'test' })).toBeNull();
  });
});
