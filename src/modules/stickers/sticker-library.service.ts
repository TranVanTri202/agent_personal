import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { STICKER_EMOTIONS, StickerEmotion, StickersConfigSchema } from './stickers.types';

@Injectable()
export class StickerLibraryService implements OnModuleInit, OnModuleDestroy {
  private configPath: string;
  private library: Record<StickerEmotion, string[]> = {
    hello: [],
    happy: [],
    funny: [],
    thanks: [],
    sorry: [],
    celebrate: [],
    encourage: [],
    love: [],
    surprised: [],
    thinking: [],
    goodbye: [],
  };
  private fileWatcher: fs.FSWatcher | null = null;

  constructor(
    private readonly logger: AppLoggerService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.configPath = path.resolve(process.cwd(), 'config/stickers.json');
  }

  async onModuleInit() {
    this.loadLibrary();
    await this.loadFromDatabase();
    this.setupFileWatcher();
  }

  onModuleDestroy() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  loadLibrary(): { success: boolean; totalCount: number; message: string } {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.logger.warn(`[STICKER_LIBRARY] File not found at ${this.configPath}. Initializing empty library.`);
        return { success: false, totalCount: 0, message: `File không tồn tại tại: ${this.configPath}` };
      }

      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      const validated = StickersConfigSchema.parse(parsed);

      this.library = validated;
      const totalCount = this.getTotalCount();

      this.logger.log(`[STICKER_LIBRARY] Loaded ${totalCount} sticker IDs across ${STICKER_EMOTIONS.length} emotion categories.`);
      return {
        success: true,
        totalCount,
        message: `Đã nạp ${totalCount} sticker ID từ ${this.configPath}`,
      };
    } catch (err: any) {
      this.logger.error(`[STICKER_LIBRARY_ERROR] Failed parsing stickers.json: ${err.message}. Retaining current library.`);
      return {
        success: false,
        totalCount: this.getTotalCount(),
        message: `Lỗi khi đọc file config/stickers.json: ${err.message}`,
      };
    }
  }

  async loadFromDatabase(): Promise<void> {
    if (!this.prisma) return;

    try {
      const dbItems = await this.prisma.stickerItem.findMany();
      if (!dbItems || dbItems.length === 0) return;

      for (const item of dbItems) {
        if (this.isValidEmotion(item.emotion)) {
          const current = this.library[item.emotion as StickerEmotion] || [];
          if (!current.includes(item.stickerId)) {
            current.push(item.stickerId);
            this.library[item.emotion as StickerEmotion] = current;
          }
        }
      }

      this.logger.log(`[STICKER_LIBRARY] Merged ${dbItems.length} stickers from database. Total: ${this.getTotalCount()}`);
    } catch (err: any) {
      this.logger.warn(`[STICKER_LIBRARY] Could not load stickers from database: ${err.message}`);
    }
  }

  async reload(): Promise<{ success: boolean; totalCount: number; message: string }> {
    const fileRes = this.loadLibrary();
    await this.loadFromDatabase();
    return {
      success: fileRes.success,
      totalCount: this.getTotalCount(),
      message: fileRes.message,
    };
  }

  async addStickers(
    emotion: StickerEmotion,
    stickerIds: string[],
    userId?: string,
  ): Promise<{ addedCount: number; duplicateCount: number }> {
    if (!stickerIds.length) {
      return { addedCount: 0, duplicateCount: 0 };
    }

    const currentSet = new Set(this.library[emotion] || []);
    let addedCount = 0;
    let duplicateCount = 0;

    for (const id of stickerIds) {
      if (currentSet.has(id)) {
        duplicateCount++;
      } else {
        currentSet.add(id);
        addedCount++;

        // Persist to DB if prisma available
        if (this.prisma) {
          try {
            await this.prisma.stickerItem.upsert({
              where: {
                stickerId_emotion: {
                  stickerId: id,
                  emotion,
                },
              },
              create: {
                stickerId: id,
                emotion,
                source: 'collector',
                addedBy: userId,
              },
              update: {},
            });
          } catch (err: any) {
            this.logger.error(`[STICKER_DB_ERROR] Failed upserting sticker ${id}: ${err.message}`);
          }
        }
      }
    }

    this.library[emotion] = Array.from(currentSet);
    this.saveToFileSafe();

    return { addedCount, duplicateCount };
  }

  private saveToFileSafe() {
    try {
      const data = JSON.stringify(this.library, null, 2);
      fs.writeFileSync(this.configPath, data, 'utf8');
      this.logger.log(`[STICKER_LIBRARY] Synced library to ${this.configPath}`);
    } catch (err: any) {
      this.logger.warn(`[STICKER_LIBRARY] Could not save to ${this.configPath}: ${err.message}`);
    }
  }

  private setupFileWatcher() {
    try {
      if (fs.existsSync(this.configPath)) {
        let debounceTimer: NodeJS.Timeout | null = null;
        this.fileWatcher = fs.watch(this.configPath, (eventType) => {
          if (eventType === 'change') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              this.logger.log('[STICKER_LIBRARY] Detected change in config/stickers.json. Reloading...');
              this.loadLibrary();
              this.loadFromDatabase().catch(() => {});
            }, 500);
          }
        });
      }
    } catch (err: any) {
      this.logger.warn(`[STICKER_LIBRARY] Could not attach file watcher: ${err.message}`);
    }
  }

  getStickers(emotion: StickerEmotion): string[] {
    return this.library[emotion] || [];
  }

  isValidEmotion(emotion: string): emotion is StickerEmotion {
    return STICKER_EMOTIONS.includes(emotion as StickerEmotion);
  }

  getEmotionCounts(): Record<StickerEmotion, number> {
    const counts: Record<string, number> = {};
    for (const em of STICKER_EMOTIONS) {
      counts[em] = (this.library[em] || []).length;
    }
    return counts as Record<StickerEmotion, number>;
  }

  getTotalCount(): number {
    return Object.values(this.library).reduce((acc, arr) => acc + arr.length, 0);
  }
}
