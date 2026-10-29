import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface PendingClarificationData {
  intent: 'REMINDER' | 'EMAIL' | 'FILE' | 'IMAGE';
  prompt: string;
  originalText: string;
  missingSlots: string[];
}

export interface ConversationStateData {
  conversationId: string;
  userId: string;
  chatId: string;
  chatType: 'PRIVATE' | 'GROUP';
  currentTopic?: string | null;
  activeTaskId?: string | null;
  lastReminderId?: string | null;
  lastEmailThreadIds?: string[];
  lastFileIds?: string[];
  lastImageIds?: string[];
  pendingClarification?: PendingClarificationData | null;
}

@Injectable()
export class ConversationStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  async getOrCreateState(
    conversationId: string,
    userId: string,
    chatId: string,
    chatType: 'PRIVATE' | 'GROUP' = 'PRIVATE',
  ): Promise<ConversationStateData> {
    let state = await this.prisma.conversationState.findUnique({
      where: { conversationId },
    });

    if (!state) {
      state = await this.prisma.conversationState.create({
        data: {
          conversationId,
          userId,
          chatId,
          chatType,
        },
      });
    }

    return {
      conversationId: state.conversationId,
      userId: state.userId,
      chatId: state.chatId,
      chatType: state.chatType as 'PRIVATE' | 'GROUP',
      currentTopic: state.currentTopic,
      activeTaskId: state.activeTaskId,
      lastReminderId: state.lastReminderId,
      lastEmailThreadIds: Array.isArray(state.lastEmailThreadIds) ? (state.lastEmailThreadIds as string[]) : [],
      lastFileIds: Array.isArray(state.lastFileIds) ? (state.lastFileIds as string[]) : [],
      lastImageIds: Array.isArray(state.lastImageIds) ? (state.lastImageIds as string[]) : [],
      pendingClarification: state.pendingClarification as PendingClarificationData | null,
    };
  }

  private async ensureState(conversationId: string) {
    let state = await this.prisma.conversationState.findUnique({ where: { conversationId } });
    if (!state) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
      if (conv) {
        state = await this.prisma.conversationState.create({
          data: {
            conversationId,
            userId: conv.ownerId || '',
            chatId: conv.externalChatId,
            chatType: (conv.type as any) || 'PRIVATE',
          },
        });
      }
    }
    return state;
  }

  async recordReminder(conversationId: string, reminderId: string): Promise<void> {
    try {
      await this.ensureState(conversationId);
      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          lastReminderId: reminderId,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`[CONV_STATE] Recorded lastReminderId "${reminderId}" for conv ${conversationId}`);
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed recording reminder: ${err.message}`);
    }
  }

  async recordFile(conversationId: string, fileId: string): Promise<void> {
    try {
      const state = await this.ensureState(conversationId);
      const current = Array.isArray(state?.lastFileIds) ? (state.lastFileIds as string[]) : [];
      const updated = [fileId, ...current.filter((id) => id !== fileId)].slice(0, 5);

      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          lastFileIds: updated,
          updatedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed recording file: ${err.message}`);
    }
  }

  async recordImage(conversationId: string, imageId: string): Promise<void> {
    try {
      const state = await this.ensureState(conversationId);
      const current = Array.isArray(state?.lastImageIds) ? (state.lastImageIds as string[]) : [];
      const updated = [imageId, ...current.filter((id) => id !== imageId)].slice(0, 5);

      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          lastImageIds: updated,
          updatedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed recording image: ${err.message}`);
    }
  }

  async recordEmailThreads(conversationId: string, threadIds: string[]): Promise<void> {
    try {
      await this.ensureState(conversationId);
      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          lastEmailThreadIds: threadIds.slice(0, 10),
          updatedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed recording email threads: ${err.message}`);
    }
  }

  async setPendingClarification(conversationId: string, clarification: PendingClarificationData): Promise<void> {
    try {
      await this.ensureState(conversationId);
      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          pendingClarification: clarification as any,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`[CONV_STATE] Set pending clarification for conv ${conversationId}: ${clarification.intent}`);
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed setting pending clarification: ${err.message}`);
    }
  }

  async clearPendingClarification(conversationId: string): Promise<void> {
    try {
      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          pendingClarification: Prisma.DbNull,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Ignored
    }
  }

  async resetState(conversationId: string, newEpoch = 1): Promise<void> {
    try {
      await this.prisma.conversationState.update({
        where: { conversationId },
        data: {
          conversationEpoch: newEpoch,
          currentTopic: null,
          activeTaskId: null,
          lastReminderId: null,
          lastEmailThreadIds: [],
          lastFileIds: [],
          lastImageIds: [],
          pendingClarification: Prisma.DbNull,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`[CONV_STATE] Reset conversation state for conv ${conversationId} to epoch ${newEpoch}`);
    } catch (err: any) {
      this.logger.warn(`[CONV_STATE_ERROR] Failed resetting conversation state: ${err.message}`);
    }
  }
}
