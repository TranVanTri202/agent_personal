import { StickerService } from '../../src/modules/stickers/sticker.service';
import { StickerLibraryService } from '../../src/modules/stickers/sticker-library.service';
import { StickerSelectorService } from '../../src/modules/stickers/sticker-selector.service';
import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';

describe('Sticker Collection Flow', () => {
  let stickerService: StickerService;
  let libraryService: StickerLibraryService;
  let selectorService: StickerSelectorService;
  let mockZaloClient: any;
  let mockLogger: any;
  let mockPrisma: any;

  // In-memory mock database tables
  let mockSessions: Record<string, any> = {};
  let mockStickerItems: Array<{ stickerId: string; emotion: string; source: string; addedBy?: string }> = [];

  beforeEach(() => {
    mockSessions = {};
    mockStickerItems = [];

    mockZaloClient = {
      sendSticker: jest.fn().mockResolvedValue({ ok: true }),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockPrisma = {
      stickerSession: {
        upsert: jest.fn(async ({ where, create, update }) => {
          mockSessions[where.chatId] = {
            chatId: where.chatId,
            ...(mockSessions[where.chatId] ? update : create),
          };
          return mockSessions[where.chatId];
        }),
        findUnique: jest.fn(async ({ where }) => {
          return mockSessions[where.chatId] || null;
        }),
        update: jest.fn(async ({ where, data }) => {
          if (mockSessions[where.chatId]) {
            Object.assign(mockSessions[where.chatId], data);
          }
          return mockSessions[where.chatId];
        }),
        delete: jest.fn(async ({ where }) => {
          delete mockSessions[where.chatId];
          return { ok: true };
        }),
      },
      stickerItem: {
        findMany: jest.fn(async () => mockStickerItems),
        upsert: jest.fn(async ({ where, create }) => {
          const existing = mockStickerItems.find(
            (s) => s.stickerId === where.stickerId_emotion.stickerId && s.emotion === where.stickerId_emotion.emotion,
          );
          if (!existing) {
            mockStickerItems.push(create);
          }
          return create;
        }),
      },
    };

    libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService, mockPrisma);
    selectorService = new StickerSelectorService(libraryService);
    stickerService = new StickerService(
      mockZaloClient as unknown as ZaloApiClient,
      selectorService,
      libraryService,
      mockLogger as unknown as AppLoggerService,
      mockPrisma,
    );
  });

  it('should start a new collection session for valid emotion', async () => {
    const res = await stickerService.startSession('chat-owner-1', 'user-owner-1', 'sorry');

    expect(res.success).toBe(true);
    expect(res.message).toContain('sorry');

    const session = await stickerService.getActiveSession('chat-owner-1');
    expect(session).not.toBeNull();
    expect(session?.emotion).toBe('sorry');
    expect(session?.collectedIds).toEqual([]);
  });

  it('should capture incoming stickers into active session and deduplicate within session', async () => {
    await stickerService.startSession('chat-owner-1', 'user-owner-1', 'sorry');

    // 1st sticker
    const rec1 = await stickerService.recordStickerToSession('chat-owner-1', 'stk-sorry-01');
    expect(rec1?.recorded).toBe(true);
    expect(rec1?.isNewInSession).toBe(true);
    expect(rec1?.sessionCount).toBe(1);

    // 2nd sticker
    const rec2 = await stickerService.recordStickerToSession('chat-owner-1', 'stk-sorry-02');
    expect(rec2?.recorded).toBe(true);
    expect(rec2?.isNewInSession).toBe(true);
    expect(rec2?.sessionCount).toBe(2);

    // Duplicate sticker in same session
    const rec3 = await stickerService.recordStickerToSession('chat-owner-1', 'stk-sorry-01');
    expect(rec3?.recorded).toBe(true);
    expect(rec3?.isNewInSession).toBe(false);
    expect(rec3?.sessionCount).toBe(2); // Still 2
  });

  it('should finish session, persist to database, update library, and close session', async () => {
    await stickerService.startSession('chat-owner-1', 'user-owner-1', 'sorry');
    await stickerService.recordStickerToSession('chat-owner-1', 'stk-sorry-01');
    await stickerService.recordStickerToSession('chat-owner-1', 'stk-sorry-02');

    const finishRes = await stickerService.finishSession('chat-owner-1');
    expect(finishRes).not.toBeNull();
    expect(finishRes?.emotion).toBe('sorry');
    expect(finishRes?.addedCount).toBe(2);

    // Session must be closed
    const active = await stickerService.getActiveSession('chat-owner-1');
    expect(active).toBeNull();

    // Library must have newly added stickers
    const stickersInGroup = libraryService.getStickers('sorry');
    expect(stickersInGroup).toContain('stk-sorry-01');
    expect(stickersInGroup).toContain('stk-sorry-02');

    // Database must contain the items
    expect(mockStickerItems.length).toBe(2);
  });

  it('should cancel active collection session without saving items to library', async () => {
    await stickerService.startSession('chat-owner-1', 'user-owner-1', 'happy');
    await stickerService.recordStickerToSession('chat-owner-1', 'stk-happy-temp');

    const canceled = await stickerService.cancelSession('chat-owner-1');
    expect(canceled).toBe(true);

    const active = await stickerService.getActiveSession('chat-owner-1');
    expect(active).toBeNull();

    expect(libraryService.getStickers('happy')).not.toContain('stk-happy-temp');
  });

  it('finishSession should return null if no session was active', async () => {
    const res = await stickerService.finishSession('non-existent-chat');
    expect(res).toBeNull();
  });
});
