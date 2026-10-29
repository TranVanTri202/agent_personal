import { StickerService } from '../../src/modules/stickers/sticker.service';
import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { StickerSelectorService } from '../../src/modules/stickers/sticker-selector.service';
import { StickerLibraryService } from '../../src/modules/stickers/sticker-library.service';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';

describe('StickerService Policy and Orchestration', () => {
  let stickerService: StickerService;
  let mockZaloClient: any;
  let mockSelector: any;
  let mockLibrary: any;
  let mockLogger: any;

  beforeEach(() => {
    mockZaloClient = {
      sendSticker: jest.fn().mockResolvedValue({ ok: true }),
    };

    mockSelector = {
      selectSticker: jest.fn().mockReturnValue('stk_12345'),
      selectMultipleStickers: jest.fn().mockReturnValue(['stk_1', 'stk_2']),
    };

    mockLibrary = {
      getEmotionCounts: jest.fn().mockReturnValue({ hello: 2, happy: 0 }),
      isValidEmotion: jest.fn((em) => em === 'hello' || em === 'sorry'),
      reload: jest.fn().mockReturnValue({ success: true, message: 'Reloaded' }),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    stickerService = new StickerService(
      mockZaloClient as unknown as ZaloApiClient,
      mockSelector as unknown as StickerSelectorService,
      mockLibrary as unknown as StickerLibraryService,
      mockLogger as unknown as AppLoggerService,
    );
  });

  it('should send sticker successfully when context is allowed', async () => {
    const res = await stickerService.sendSticker('chat-01', 'hello');

    expect(res.sent).toBe(true);
    expect(res.stickerId).toBe('stk_12345');
    expect(mockZaloClient.sendSticker).toHaveBeenCalledWith('chat-01', 'stk_12345');
  });

  it('should prevent sending sticker in sensitive, error, or approval contexts', async () => {
    const resApproval = await stickerService.sendSticker('chat-01', 'hello', { isApproval: true });
    expect(resApproval.sent).toBe(false);
    expect(resApproval.reason).toBe('context_not_allowed_for_sticker');

    const resError = await stickerService.sendSticker('chat-01', 'sorry', { isError: true });
    expect(resError.sent).toBe(false);

    const resSensitive = await stickerService.sendSticker('chat-01', 'hello', { isSensitive: true });
    expect(resSensitive.sent).toBe(false);

    expect(mockZaloClient.sendSticker).not.toHaveBeenCalled();
  });

  it('should handle empty category gracefully without crashing or throwing', async () => {
    mockSelector.selectSticker.mockReturnValue(null);

    const res = await stickerService.sendSticker('chat-01', 'hello');
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('no_stickers_in_category');
    expect(mockZaloClient.sendSticker).not.toHaveBeenCalled();
  });

  it('should not throw if Zalo sendSticker API fails with network error', async () => {
    mockZaloClient.sendSticker.mockRejectedValue(new Error('Network timeout'));

    const res = await stickerService.sendSticker('chat-01', 'hello');
    expect(res.sent).toBe(false);
    expect(res.error).toBe('Network timeout');
  });
});
