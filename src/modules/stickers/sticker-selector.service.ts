import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { StickerLibraryService } from './sticker-library.service';
import { StickerEmotion } from './stickers.types';

@Injectable()
export class StickerSelectorService {
  // chatId -> Record<emotion, recentStickerIds[]>
  private recentHistory = new Map<string, Map<StickerEmotion, string[]>>();
  private readonly maxRecentPerEmotion = 5;

  constructor(private readonly libraryService: StickerLibraryService) {}

  selectSticker(chatId: string, emotion: StickerEmotion): string | null {
    const stickers = this.libraryService.getStickers(emotion);
    if (!stickers || stickers.length === 0) {
      return null;
    }

    // If only 1 sticker exists in group, always return it without blocking
    if (stickers.length === 1) {
      return stickers[0];
    }

    const recent = this.getRecentForChat(chatId, emotion);
    // Candidates are stickers that have not been sent recently
    let candidates = stickers.filter((id) => !recent.includes(id));

    // If all stickers have been used recently, clear recent and use full list
    if (candidates.length === 0) {
      candidates = stickers;
      this.clearRecentForChat(chatId, emotion);
    }

    // Pick uniformly using crypto.randomInt
    const index = crypto.randomInt(0, candidates.length);
    const selected = candidates[index];

    this.recordRecent(chatId, emotion, selected);
    return selected;
  }

  selectMultipleStickers(chatId: string, emotion: StickerEmotion, count: number): string[] {
    const stickers = this.libraryService.getStickers(emotion);
    if (!stickers || stickers.length === 0 || count <= 0) {
      return [];
    }

    const targetCount = Math.min(count, 10); // cap max 10 to protect API rate limit
    const results: string[] = [];

    // If only 1 ID, duplicate if requested
    if (stickers.length === 1) {
      for (let i = 0; i < targetCount; i++) {
        results.push(stickers[0]);
      }
      return results;
    }

    // If multiple IDs, shuffle without immediate repetition
    const pool = [...stickers];
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    for (let i = 0; i < targetCount; i++) {
      results.push(pool[i % pool.length]);
    }

    if (results.length > 0) {
      this.recordRecent(chatId, emotion, results[results.length - 1]);
    }

    return results;
  }

  private getRecentForChat(chatId: string, emotion: StickerEmotion): string[] {
    const chatMap = this.recentHistory.get(chatId);
    if (!chatMap) return [];
    return chatMap.get(emotion) || [];
  }

  private clearRecentForChat(chatId: string, emotion: StickerEmotion) {
    const chatMap = this.recentHistory.get(chatId);
    if (chatMap) {
      chatMap.set(emotion, []);
    }
  }

  private recordRecent(chatId: string, emotion: StickerEmotion, stickerId: string) {
    let chatMap = this.recentHistory.get(chatId);
    if (!chatMap) {
      chatMap = new Map();
      this.recentHistory.set(chatId, chatMap);
    }

    const list = chatMap.get(emotion) || [];
    list.push(stickerId);
    if (list.length > this.maxRecentPerEmotion) {
      list.shift();
    }
    chatMap.set(emotion, list);
  }
}
