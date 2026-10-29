import { Injectable } from '@nestjs/common';
import { ConversationStateService, ConversationStateData } from './conversation-state.service';
import { ReminderTimeParser } from '../scheduler/reminder-time-parser';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface ResolvedReference {
  kind: 'image' | 'file' | 'email' | 'reminder' | 'task' | 'message' | 'list_item' | 'none';
  entityId?: string;
  sourceMessageId?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface ResolutionResult {
  augmentedText: string;
  hasClarificationAnswer: boolean;
  resolvedReminderId?: string;
  resolvedEmailId?: string;
  resolvedFileId?: string;
  resolvedImageId?: string;
  references: ResolvedReference[];
  injectedContextPrompt?: string;
}

@Injectable()
export class ContextResolverService {
  constructor(
    private readonly stateService: ConversationStateService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  async resolveContext(
    conversationId: string,
    userId: string,
    chatId: string,
    rawText: string,
    chatType: 'PRIVATE' | 'GROUP' = 'PRIVATE',
    replyToMessageId?: string,
  ): Promise<ResolutionResult> {
    const state = await this.stateService.getOrCreateState(conversationId, userId, chatId, chatType);
    const lower = rawText.toLowerCase().trim();
    const contextLines: string[] = [];
    const references: ResolvedReference[] = [];
    let augmentedText = rawText;
    let hasClarificationAnswer = false;
    let resolvedReminderId: string | undefined;
    let resolvedEmailId: string | undefined;
    let resolvedFileId: string | undefined;
    let resolvedImageId: string | undefined;

    // 1. Check if user is answering a pending clarification
    if (state.pendingClarification) {
      const pending = state.pendingClarification;
      if (pending.intent === 'REMINDER') {
        const timeParsed = ReminderTimeParser.parse(rawText);
        if (timeParsed.success && timeParsed.dueAt) {
          hasClarificationAnswer = true;
          augmentedText = `${pending.originalText} vào lúc ${rawText}`.trim();
          this.logger.log(`[CONTEXT_RESOLVER] Resolved pending clarification for REMINDER: "${augmentedText}"`);
          await this.stateService.clearPendingClarification(conversationId);
        }
      }
    }

    // 2. Check Reply-To Message (Priority 1)
    if (replyToMessageId) {
      try {
        const repliedMsg = await this.prisma.message.findFirst({
          where: { externalMessageId: replyToMessageId, conversationId },
        });

        if (repliedMsg) {
          const atts = Array.isArray(repliedMsg.attachmentsJson)
            ? (repliedMsg.attachmentsJson as any[])
            : [];
          const imgAtt = atts.find((a) => a.type === 'IMAGE');
          const fileAtt = atts.find((a) => a.type === 'FILE');

          if (imgAtt) {
            // Find stored file for this attachment
            const sf = await this.prisma.storedFile.findFirst({
              where: { conversationId, mimeType: { startsWith: 'image/' }, status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
            });
            if (sf) {
              resolvedImageId = sf.id;
              references.push({
                kind: 'image',
                entityId: sf.id,
                sourceMessageId: repliedMsg.id,
                confidence: 'high',
                reason: 'Người dùng reply trực tiếp tin nhắn có chứa ảnh',
              });
            }
          } else if (fileAtt) {
            const sf = await this.prisma.storedFile.findFirst({
              where: { conversationId, status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
            });
            if (sf) {
              resolvedFileId = sf.id;
              references.push({
                kind: 'file',
                entityId: sf.id,
                sourceMessageId: repliedMsg.id,
                confidence: 'high',
                reason: 'Người dùng reply trực tiếp tin nhắn có chứa tệp',
              });
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`[CONTEXT_RESOLVER] Error inspecting replyToMessageId: ${err.message}`);
      }
    }

    // 3. Resolve Reminder references ("nó", "lời nhắc vừa rồi", "dời thêm", "hoãn", "hủy")
    const reminderKeywords = ['lời nhắc', 'nhắc việc', 'dời thêm', 'hoãn thêm', 'hủy nó', 'hủy đi', 'đổi giờ'];
    if (reminderKeywords.some((kw) => lower.includes(kw)) && state.lastReminderId) {
      resolvedReminderId = state.lastReminderId;
      references.push({
        kind: 'reminder',
        entityId: state.lastReminderId,
        confidence: 'high',
        reason: 'Khớp từ khóa tham chiếu lời nhắc gần nhất',
      });
      contextLines.push(
        `- Lời nhắc đang được người dùng tham chiếu gần nhất có mã ID: "${state.lastReminderId}". Nếu người dùng yêu cầu dời hoặc hủy, hãy dùng ID này.`,
      );
    }

    // 4. Resolve Email references (ONLY in PRIVATE chat - Security Isolation for GROUP)
    if (chatType === 'PRIVATE') {
      if (state.lastEmailThreadIds && state.lastEmailThreadIds.length > 0) {
        const emailOrdinalMatch = lower.match(/(?:cái|email|thư|thư số|tin)\s*(?:thứ\s*)?([1-9]|nhất|hai|ba|bốn|năm)/);
        if (emailOrdinalMatch) {
          const ordStr = emailOrdinalMatch[1];
          let idx = 0;
          if (ordStr === 'nhất' || ordStr === '1') idx = 0;
          else if (ordStr === 'hai' || ordStr === '2') idx = 1;
          else if (ordStr === 'ba' || ordStr === '3') idx = 2;
          else if (ordStr === 'bốn' || ordStr === '4') idx = 3;
          else if (ordStr === 'năm' || ordStr === '5') idx = 4;
          else {
            const num = parseInt(ordStr, 10);
            if (!isNaN(num) && num >= 1) idx = num - 1;
          }

          if (idx < state.lastEmailThreadIds.length) {
            resolvedEmailId = state.lastEmailThreadIds[idx];
            references.push({
              kind: 'email',
              entityId: resolvedEmailId,
              confidence: 'high',
              reason: `Khớp số thứ tự email: thứ ${idx + 1}`,
            });
            contextLines.push(
              `- Email thứ ${idx + 1} người dùng đang tham chiếu có Thread/Message ID: "${resolvedEmailId}".`,
            );
          }
        }
      }
    } else {
      // In GROUP chat: explicit notice if user attempts to reference email
      if (lower.includes('email') || lower.includes('thư') || lower.includes('gmail')) {
        contextLines.push(
          `- CHÚ Ý BẢO MẬT: Đây là cuộc trò chuyện NHÓM. Tuyệt đối KHÔNG đọc, trích xuất hoặc gửi thông tin Email/Gmail riêng của Owner vào nhóm. Hướng dẫn người dùng nhắn tin riêng (1-1) với bot nếu muốn kiểm tra email.`,
        );
      }
    }

    // 5. Resolve Image references ("ảnh đó", "ảnh này", "ảnh vừa rồi", "hình đó", "gửi lại coi", "ảnh thứ 1", "ảnh thứ 2")
    const imageKeywords = [
      'ảnh',
      'bức ảnh',
      'hình',
      'tấm ảnh',
      'gửi lại coi',
      'gửi lại đi',
      'gửi lại',
      'anh',
      'buc anh',
      'hinh',
      'tam anh',
      'gui lai coi',
      'gui lai di',
      'gui lai',
      'gui',
    ];
    const hasImageReferent = imageKeywords.some((kw) => lower.includes(kw));

    if (hasImageReferent && !resolvedImageId) {
      let imagePool = Array.isArray(state.lastImageIds) ? (state.lastImageIds as string[]) : [];

      // Fallback: If memory state is empty, query DB for recent active images in this conversation
      if (imagePool.length === 0 && this.prisma?.storedFile?.findMany) {
        const recentFiles = await this.prisma.storedFile.findMany({
          where: {
            conversationId,
            mimeType: { startsWith: 'image/' },
            status: 'ACTIVE',
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        imagePool = recentFiles.map((f) => f.id);
      }

      if (imagePool.length > 0) {
        let selectedIdx = 0;
        // Check ordinal ("ảnh thứ nhất", "ảnh thứ 2", "ảnh đầu")
        const imgOrdinalMatch = lower.match(/(?:ảnh|hình|tấm|anh|hinh|tam)\s*(?:thứ\s*|thu\s*)?([1-9]|nhất|nhat|đầu|dau|hai|ba|bốn|bon|năm|nam)/);
        if (imgOrdinalMatch) {
          const ordStr = imgOrdinalMatch[1];
          if (ordStr === 'nhất' || ordStr === 'nhat' || ordStr === 'đầu' || ordStr === 'dau' || ordStr === '1') selectedIdx = 0;
          else if (ordStr === 'hai' || ordStr === '2') selectedIdx = 1;
          else if (ordStr === 'ba' || ordStr === '3') selectedIdx = 2;
          else if (ordStr === 'bốn' || ordStr === 'bon' || ordStr === '4') selectedIdx = 3;
          else if (ordStr === 'năm' || ordStr === 'nam' || ordStr === '5') selectedIdx = 4;
          else {
            const num = parseInt(ordStr, 10);
            if (!isNaN(num) && num >= 1) selectedIdx = num - 1;
          }
        }

        if (selectedIdx < imagePool.length) {
          resolvedImageId = imagePool[selectedIdx];
          references.push({
            kind: 'image',
            entityId: resolvedImageId,
            confidence: 'high',
            reason: `Tham chiếu ảnh trong cuộc trò chuyện (vị trí: ${selectedIdx + 1})`,
          });
        }
      }
    }

    if (resolvedImageId) {
      contextLines.push(
        `- Ảnh đang được người dùng tham chiếu trong hội thoại có Media/File ID: "${resolvedImageId}".\n` +
          `  + Khi người dùng hỏi nội dung/thông tin ảnh ("ảnh có gì", "ảnh đó là gì", "xem ảnh"): BẮT BUỘC gọi tool "analyze_existing_image" với mediaId="${resolvedImageId}".\n` +
          `  + Khi người dùng yêu cầu gửi lại ảnh ("gửi lại coi", "gửi lại ảnh đó", "cho xem lại"): BẮT BUỘC gọi tool "resend_existing_media" với mediaId="${resolvedImageId}".\n` +
          `  + Khi người dùng muốn chỉnh sửa ("đổi màu", "chibi hóa"): BẮT BUỘC gọi tool "edit_image" với sourceFileId="${resolvedImageId}".`,
      );
    }

    // 6. Resolve File references ("file này", "tài liệu vừa tạo", "gửi file", "bảng tính vừa rồi")
    if ((lower.includes('file') || lower.includes('tài liệu') || lower.includes('bảng tính')) && !resolvedFileId) {
      let filePool = Array.isArray(state.lastFileIds) ? (state.lastFileIds as string[]) : [];
      if (filePool.length === 0 && this.prisma?.storedFile?.findMany) {
        const recentDocFiles = await this.prisma.storedFile.findMany({
          where: {
            conversationId,
            mimeType: { not: { startsWith: 'image/' } },
            status: 'ACTIVE',
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        filePool = recentDocFiles.map((f) => f.id);
      }

      if (filePool.length > 0) {
        resolvedFileId = filePool[0];
        references.push({
          kind: 'file',
          entityId: resolvedFileId,
          confidence: 'high',
          reason: 'Khớp tệp tài liệu gần nhất trong cuộc trò chuyện',
        });
        contextLines.push(
          `- Tệp tài liệu gần nhất trong cuộc trò chuyện có File ID: "${resolvedFileId}". Nếu người dùng yêu cầu gửi lại file, hãy gọi tool "resend_existing_media" với mediaId="${resolvedFileId}".`,
        );
      }
    }

    const injectedContextPrompt =
      contextLines.length > 0
        ? `\n\n[NGỮ CẢNH HỘI THOẠI ĐA LƯỢT ĐÃ ĐƯỢC GIẢI MÃ TỪ HỆ THỐNG]:\n${contextLines.join('\n')}\n`
        : undefined;

    return {
      augmentedText,
      hasClarificationAnswer,
      resolvedReminderId,
      resolvedEmailId,
      resolvedFileId,
      resolvedImageId,
      references,
      injectedContextPrompt,
    };
  }
}
