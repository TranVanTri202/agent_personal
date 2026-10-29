import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Conversation, Message, MessageDirection, MessageType } from '@prisma/client';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateConversation(
    channel: string,
    externalChatId: string,
    type: 'PRIVATE' | 'GROUP',
    ownerId?: string,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        channel_externalChatId: {
          channel,
          externalChatId,
        },
      },
    });

    if (existing) {
      if (ownerId && !existing.ownerId) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { ownerId },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: {
        channel,
        externalChatId,
        type,
        ownerId,
      },
    });
  }

  async saveMessage(params: {
    conversationId: string;
    externalMessageId?: string;
    direction: MessageDirection;
    content: string;
    type?: MessageType;
    attachmentsJson?: any;
    metadataJson?: any;
  }): Promise<Message> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { conversationEpoch: true },
    });
    const epoch = conv?.conversationEpoch || 1;

    return this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        externalMessageId: params.externalMessageId,
        direction: params.direction,
        content: params.content,
        type: params.type || MessageType.TEXT,
        epoch,
        attachmentsJson: params.attachmentsJson,
        metadataJson: params.metadataJson,
      },
    });
  }

  async getRecentMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { conversationEpoch: true },
    });
    const currentEpoch = conv?.conversationEpoch || 1;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        epoch: currentEpoch,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return messages.reverse();
  }

  async resetConversation(conversationId: string): Promise<{ success: boolean; newEpoch: number }> {
    return this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { conversationEpoch: true },
      });
      const newEpoch = (conv?.conversationEpoch || 1) + 1;

      await tx.conversation.update({
        where: { id: conversationId },
        data: { conversationEpoch: newEpoch },
      });

      await tx.conversationState.upsert({
        where: { conversationId },
        update: {
          conversationEpoch: newEpoch,
          currentTopic: null,
          activeTaskId: null,
          lastReminderId: null,
          lastEmailThreadIds: [],
          lastFileIds: [],
          lastImageIds: [],
          pendingClarification: null as any,
          updatedAt: new Date(),
        },
        create: {
          conversationId,
          userId: 'reset',
          chatId: 'reset',
          chatType: 'PRIVATE',
          conversationEpoch: newEpoch,
        },
      });

      return { success: true, newEpoch };
    });
  }
}
