import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';

describe('ZaloApiClient Message Splitting', () => {
  let client: ZaloApiClient;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'ZALO_MAX_MESSAGE_LENGTH') return 50;
        return null;
      }),
    } as unknown as ConfigService;

    const logger = {
      error: jest.fn(),
      log: jest.fn(),
    } as unknown as AppLoggerService;

    const mockBot = {} as any;
    const { ZaloChannelAdapter } = require('../../src/modules/zalo/zalo-channel.adapter');
    const adapter = new ZaloChannelAdapter(mockBot, configService, logger);
    client = new ZaloApiClient(adapter);
  });

  it('should not split text shorter than max length', () => {
    const text = 'Tin nhắn ngắn';
    const chunks = client.splitMessage(text, 50);
    expect(chunks).toEqual(['Tin nhắn ngắn']);
  });

  it('should split long text by paragraph or newline properly', () => {
    const paragraph1 = 'Đây là đoạn văn bản thứ nhất rất quan trọng.';
    const paragraph2 = 'Đây là đoạn văn bản thứ hai tiếp theo.';
    const text = `${paragraph1}\n\n${paragraph2}`;

    const chunks = client.splitMessage(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe(paragraph1);
    expect(chunks[1]).toBe(paragraph2);
  });

  it('should not split in the middle of UTF-16 surrogate pairs (emojis)', () => {
    const emoji = '🎉🎊🚀';
    const filler = 'a'.repeat(48);
    const text = filler + emoji; // length 54

    const chunks = client.splitMessage(text, 50);
    expect(chunks.length).toBe(2);
    // Ensure no broken unicode characters
    for (const chunk of chunks) {
      expect(() => Buffer.from(chunk, 'utf8')).not.toThrow();
    }
  });
});
