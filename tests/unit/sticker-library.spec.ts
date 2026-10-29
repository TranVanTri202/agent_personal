import { StickerLibraryService } from '../../src/modules/stickers/sticker-library.service';
import { StickerSelectorService } from '../../src/modules/stickers/sticker-selector.service';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';
import * as fs from 'fs';
import * as path from 'path';

describe('StickerLibraryService & StickerSelectorService', () => {
  let mockLogger: any;
  const testConfigPath = path.resolve(process.cwd(), 'config/stickers.test.json');

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  it('should handle empty sticker groups without crashing or returning IDs', () => {
    fs.writeFileSync(
      testConfigPath,
      JSON.stringify({
        hello: [],
        sorry: [],
        happy: [],
      }),
    );

    const libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService);
    // override internal config path for test
    (libraryService as any).configPath = testConfigPath;
    libraryService.loadLibrary();

    expect(libraryService.getTotalCount()).toBe(0);
    expect(libraryService.getStickers('hello')).toEqual([]);

    const selector = new StickerSelectorService(libraryService);
    const selected = selector.selectSticker('chat-01', 'hello');
    expect(selected).toBeNull();
  });

  it('should select randomly from multiple IDs and avoid immediate repetition in the same chat', () => {
    fs.writeFileSync(
      testConfigPath,
      JSON.stringify({
        sorry: ['id_sorry_1', 'id_sorry_2', 'id_sorry_3'],
      }),
    );

    const libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService);
    (libraryService as any).configPath = testConfigPath;
    libraryService.loadLibrary();

    const selector = new StickerSelectorService(libraryService);
    const first = selector.selectSticker('chat-01', 'sorry');
    expect(['id_sorry_1', 'id_sorry_2', 'id_sorry_3']).toContain(first);

    // Second pick in the same chat should avoid the one just picked
    const second = selector.selectSticker('chat-01', 'sorry');
    expect(['id_sorry_1', 'id_sorry_2', 'id_sorry_3']).toContain(second);
    expect(second).not.toBe(first);
  });

  it('should continue to return the single ID if group has only 1 sticker', () => {
    fs.writeFileSync(
      testConfigPath,
      JSON.stringify({
        thanks: ['id_thanks_unique'],
      }),
    );

    const libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService);
    (libraryService as any).configPath = testConfigPath;
    libraryService.loadLibrary();

    const selector = new StickerSelectorService(libraryService);
    const first = selector.selectSticker('chat-01', 'thanks');
    const second = selector.selectSticker('chat-01', 'thanks');

    expect(first).toBe('id_thanks_unique');
    expect(second).toBe('id_thanks_unique');
  });

  it('should sanitize, deduplicate, and trim sticker IDs from file', () => {
    fs.writeFileSync(
      testConfigPath,
      JSON.stringify({
        celebrate: ['  id_cel_1  ', 'id_cel_1', '', 'id_cel_2  '],
      }),
    );

    const libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService);
    (libraryService as any).configPath = testConfigPath;
    libraryService.loadLibrary();

    const celebrateStickers = libraryService.getStickers('celebrate');
    expect(celebrateStickers).toEqual(['id_cel_1', 'id_cel_2']);
  });

  it('should gracefully handle malformed JSON without crashing', () => {
    fs.writeFileSync(testConfigPath, '{ malformed json: true,');

    const libraryService = new StickerLibraryService(mockLogger as unknown as AppLoggerService);
    (libraryService as any).configPath = testConfigPath;
    const res = libraryService.loadLibrary();

    expect(res.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    expect(libraryService.getTotalCount()).toBe(0);
  });
});
