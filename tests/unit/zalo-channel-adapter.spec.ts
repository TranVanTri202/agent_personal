import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ZaloChannelAdapter } from '../../src/modules/zalo/zalo-channel.adapter';
import { ZALO_BOT_INSTANCE } from '../../src/modules/zalo/zalo-bot.provider';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';

describe('ZaloChannelAdapter', () => {
  let adapter: ZaloChannelAdapter;
  let mockBot: any;
  let mockLogger: any;

  beforeEach(async () => {
    mockBot = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: 'msg-photo-1' }),
      sendSticker: jest.fn().mockResolvedValue({ messageId: 'msg-sticker-1' }),
      sendVoice: jest.fn().mockResolvedValue({ messageId: 'msg-voice-1' }),
      sendChatAction: jest.fn().mockResolvedValue(true),
      getMe: jest.fn().mockResolvedValue({ id: 'bot-123', displayName: 'Test Bot', accountName: 'test_bot', isBot: true }),
      getWebhookInfo: jest.fn().mockResolvedValue({ url: 'https://example.com/webhook', updatedAt: '2026-10-28' }),
      setWebhook: jest.fn().mockResolvedValue({ ok: true }),
      deleteWebhook: jest.fn().mockResolvedValue(true),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZaloChannelAdapter,
        {
          provide: ZALO_BOT_INSTANCE,
          useValue: mockBot,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ZALO_BOT_TOKEN') return 'test-token-123';
              if (key === 'ZALO_MAX_MESSAGE_LENGTH') return 2000;
              return undefined;
            }),
          },
        },
        {
          provide: AppLoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    adapter = module.get<ZaloChannelAdapter>(ZaloChannelAdapter);
  });

  it('should be defined and report hasToken', () => {
    expect(adapter).toBeDefined();
    expect(adapter.hasToken()).toBe(true);
  });

  it('sendPhoto must correctly map arguments: (chatId, caption, photoUrl) for zalo-bot-js SDK', async () => {
    await adapter.sendPhoto('chat-999', 'https://example.com/image.jpg', 'My Caption');

    // Crucial check: in zalo-bot-js, signature is sendPhoto(chatId, caption, photo, options)
    expect(mockBot.sendPhoto).toHaveBeenCalledWith(
      'chat-999',
      'My Caption',
      'https://example.com/image.jpg',
    );
  });

  it('sendPhoto should provide empty caption string if omitted', async () => {
    await adapter.sendPhoto('chat-999', 'https://example.com/image.jpg');

    expect(mockBot.sendPhoto).toHaveBeenCalledWith(
      'chat-999',
      '',
      'https://example.com/image.jpg',
    );
  });

  it('sendText should call bot.sendMessage and handle options', async () => {
    await adapter.sendText('chat-999', 'Hello world', { parseMode: 'markdown' });

    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      'chat-999',
      'Hello world',
      expect.objectContaining({ parse_mode: 'markdown' }),
    );
  });

  it('sendSticker should invoke bot.sendSticker', async () => {
    await adapter.sendSticker('chat-999', 'sticker-abc');

    expect(mockBot.sendSticker).toHaveBeenCalledWith('chat-999', 'sticker-abc');
  });

  it('sendTyping should invoke bot.sendChatAction with "typing"', async () => {
    await adapter.sendTyping('chat-999');

    expect(mockBot.sendChatAction).toHaveBeenCalledWith('chat-999', 'typing');
  });

  it('sendVoice should invoke bot.sendVoice', async () => {
    await adapter.sendVoice('chat-999', 'https://example.com/voice.aac');

    expect(mockBot.sendVoice).toHaveBeenCalledWith('chat-999', 'https://example.com/voice.aac');
  });

  it('sendFileLink should format message and delegate to sendText', async () => {
    await adapter.sendFileLink('chat-999', 'https://r2.example.com/report.xlsx', 'report.xlsx');

    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      'chat-999',
      expect.stringContaining('report.xlsx'),
      expect.anything(),
    );
  });

  it('should sanitize bot token in error logs when an error occurs', async () => {
    mockBot.sendMessage.mockRejectedValueOnce(
      new Error('API error at https://bot-api.zaloplatforms.com/bot123456:secretToken/sendMessage'),
    );

    await expect(adapter.sendText('chat-999', 'test')).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
    const errorMsg = mockLogger.error.mock.calls[0][0];
    expect(errorMsg).not.toContain('secretToken');
    expect(errorMsg).toContain('[REDACTED_TOKEN]');
  });
});
