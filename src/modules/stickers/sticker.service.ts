import { Injectable, Optional } from '@nestjs/common';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { StickerSelectorService } from './sticker-selector.service';
import { StickerLibraryService } from './sticker-library.service';
import { StickerEmotion } from './stickers.types';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface StickerSendContext {
  isSensitive?: boolean;
  isError?: boolean;
  isApproval?: boolean;
  force?: boolean;
}

export interface StickerSendResult {
  sent: boolean;
  stickerId?: string;
  reason?: string;
  error?: string;
}

export interface ActiveStickerSessionInfo {
  chatId: string;
  userId: string;
  emotion: StickerEmotion;
  collectedIds: string[];
}

@Injectable()
export class StickerService {
  constructor(
    private readonly zaloClient: ZaloApiClient,
    private readonly selector: StickerSelectorService,
    private readonly library: StickerLibraryService,
    private readonly logger: AppLoggerService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  canSendSticker(context?: StickerSendContext): boolean {
    if (context?.force) return true;
    if (context?.isApproval) return false;
    if (context?.isError) return false;
    if (context?.isSensitive) return false;
    return true;
  }

  async sendSticker(
    chatId: string,
    emotion: StickerEmotion,
    context?: StickerSendContext,
  ): Promise<StickerSendResult> {
    if (!this.canSendSticker(context)) {
      return {
        sent: false,
        reason: 'context_not_allowed_for_sticker',
      };
    }

    const stickerId = this.selector.selectSticker(chatId, emotion);
    if (!stickerId) {
      return {
        sent: false,
        reason: 'no_stickers_in_category',
      };
    }

    try {
      const res = await this.zaloClient.sendSticker(chatId, stickerId);
      if (res && res.error_code && res.error_code !== 0) {
        this.logger.warn(
          `[ZALO_STICKER] Error sending sticker ID "${stickerId}" to chat "${chatId}": ${res.description || 'API error'}`,
        );
        return {
          sent: false,
          stickerId,
          error: res.description,
        };
      }

      this.logger.log(`[ZALO_STICKER] Sent sticker [${emotion}] ID "${stickerId}" to chat "${chatId}"`);
      return {
        sent: true,
        stickerId,
      };
    } catch (err: any) {
      this.logger.error(
        `[ZALO_STICKER_ERROR] Failed sending sticker ID "${stickerId}" to chat "${chatId}": ${err.message}`,
      );
      return {
        sent: false,
        stickerId,
        error: err.message,
      };
    }
  }

  async sendMultipleStickers(
    chatId: string,
    emotion: StickerEmotion,
    count = 1,
  ): Promise<{ sentCount: number; errors: string[] }> {
    const ids = this.selector.selectMultipleStickers(chatId, emotion, count);
    if (ids.length === 0) {
      return { sentCount: 0, errors: [`Không có sticker nào trong nhóm "${emotion}".`] };
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await this.zaloClient.sendSticker(chatId, id);
        sentCount++;
        if (ids.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err: any) {
        errors.push(err.message);
      }
    }

    return { sentCount, errors };
  }

  // --- Collection Session Management ---

  async startSession(
    chatId: string,
    userId: string,
    emotion: StickerEmotion,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.prisma) {
      return { success: false, message: 'Cơ sở dữ liệu chưa sẵn sàng cho phiên thu thập.' };
    }

    try {
      await this.prisma.stickerSession.upsert({
        where: { chatId },
        create: {
          chatId,
          userId,
          emotion,
          addedIds: [],
        },
        update: {
          userId,
          emotion,
          addedIds: [],
        },
      });

      return {
        success: true,
        message: `Đã kích hoạt phiên thu thập sticker cho nhóm **${emotion}**.`,
      };
    } catch (err: any) {
      this.logger.error(`[STICKER_SESSION_START_ERROR] ${err.message}`);
      return { success: false, message: `Lỗi khi mở phiên thu thập: ${err.message}` };
    }
  }

  async getActiveSession(chatId: string): Promise<ActiveStickerSessionInfo | null> {
    if (!this.prisma) return null;

    try {
      const session = await this.prisma.stickerSession.findUnique({
        where: { chatId },
      });
      if (!session) return null;

      const rawIds = Array.isArray(session.addedIds) ? (session.addedIds as string[]) : [];
      return {
        chatId: session.chatId,
        userId: session.userId,
        emotion: session.emotion as StickerEmotion,
        collectedIds: rawIds,
      };
    } catch (err: any) {
      this.logger.warn(`[STICKER_SESSION_GET_ERROR] ${err.message}`);
      return null;
    }
  }

  async recordStickerToSession(
    chatId: string,
    stickerId: string,
  ): Promise<{ recorded: boolean; isNewInSession: boolean; sessionCount: number; emotion: string } | null> {
    if (!this.prisma) return null;

    const session = await this.getActiveSession(chatId);
    if (!session) return null;

    const currentList = new Set(session.collectedIds);
    const isNew = !currentList.has(stickerId);
    currentList.add(stickerId);
    const updatedIds = Array.from(currentList);

    await this.prisma.stickerSession.update({
      where: { chatId },
      data: {
        addedIds: updatedIds,
      },
    });

    return {
      recorded: true,
      isNewInSession: isNew,
      sessionCount: updatedIds.length,
      emotion: session.emotion,
    };
  }

  async finishSession(
    chatId: string,
  ): Promise<{ success: boolean; emotion: string; addedCount: number; duplicateCount: number; totalCount: number } | null> {
    const session = await this.getActiveSession(chatId);
    if (!session) return null;

    const { addedCount, duplicateCount } = await this.library.addStickers(
      session.emotion,
      session.collectedIds,
      session.userId,
    );

    if (this.prisma) {
      await this.prisma.stickerSession
        .delete({
          where: { chatId },
        })
        .catch(() => null);
    }

    return {
      success: true,
      emotion: session.emotion,
      addedCount,
      duplicateCount,
      totalCount: this.library.getStickers(session.emotion).length,
    };
  }

  async cancelSession(chatId: string): Promise<boolean> {
    const session = await this.getActiveSession(chatId);
    if (!session) return false;

    if (this.prisma) {
      await this.prisma.stickerSession
        .delete({
          where: { chatId },
        })
        .catch(() => null);
    }

    return true;
  }

  getLibraryCounts(): Record<StickerEmotion, number> {
    return this.library.getEmotionCounts();
  }

  isValidEmotion(emotion: string): emotion is StickerEmotion {
    return this.library.isValidEmotion(emotion);
  }

  async reloadLibrary() {
    return this.library.reload();
  }

  getStickers(emotion: StickerEmotion): string[] {
    return this.library.getStickers(emotion);
  }
}
