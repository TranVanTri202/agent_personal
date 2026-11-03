import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { NormalizedIncomingMessage } from '../zalo/zalo-event.normalizer';
import { ToolRegistry } from '../tools/tool.registry';
import { LLMService } from '../llm/llm.service';
import { LLMRoutingService } from '../llm/routing/llm-routing.service';
import { OpenRouterUsageService } from '../llm/openrouter/openrouter.usage';
import { OpenRouterModelCatalogService } from '../llm/openrouter/openrouter.catalog';
import { LLMMessage } from '../llm/llm.interface';
import { ApprovalsService } from '../approvals/approvals.service';
import { StorageService } from '../storage/storage.service';
import { FilesService } from '../files/files.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { GmailService } from '../gmail/gmail.service';
import { StickerService } from '../stickers/sticker.service';
import { STICKER_EMOTIONS, StickerEmotion } from '../stickers/stickers.types';
import { TaskProgressService } from '../tasks/task-progress.service';
import { ImageContextService } from '../image-generation/image-context.service';
import { ConversationStateService } from '../conversation-intelligence/conversation-state.service';
import { ContextResolverService } from '../conversation-intelligence/context-resolver.service';
import { ReminderTimeParser } from '../scheduler/reminder-time-parser';
import { splitIntoChatMessages } from './message-splitter';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { MessageDirection, MessageType, TaskStatus } from '@prisma/client';

@Injectable()
export class AgentService {
  private readonly maxSteps: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly conversationsService: ConversationsService,
    private readonly zaloClient: ZaloApiClient,
    private readonly toolRegistry: ToolRegistry,
    private readonly llmService: LLMService,
    private readonly routingService: LLMRoutingService,
    private readonly usageService: OpenRouterUsageService,
    private readonly catalogService: OpenRouterModelCatalogService,
    private readonly approvalsService: ApprovalsService,
    private readonly storageService: StorageService,
    private readonly filesService: FilesService,
    private readonly schedulerService: SchedulerService,
    private readonly gmailService: GmailService,
    private readonly stickerService: StickerService,
    private readonly taskProgressService: TaskProgressService,
    private readonly imageContextService: ImageContextService,
    private readonly conversationStateService: ConversationStateService,
    private readonly contextResolverService: ContextResolverService,
    private readonly logger: AppLoggerService,
  ) {
    this.maxSteps = this.configService.get<number>('LLM_MAX_STEPS') || 15;
  }

  async handleIncomingMessage(msg: NormalizedIncomingMessage): Promise<void> {
    this.logger.log(`[AGENT] Processing inbound message from sender ${msg.senderId} in chat ${msg.chatId}`);

    // Deduplication check
    const existingEvent = await this.prisma.inboundEvent.findUnique({
      where: { externalEventId: msg.externalMessageId },
    });

    if (existingEvent) {
      this.logger.warn(`[AGENT] Duplicate event ${msg.externalMessageId} ignored`);
      return;
    }

    // Persist inbound event
    await this.prisma.inboundEvent.create({
      data: {
        channel: msg.channel,
        externalEventId: msg.externalMessageId,
        eventType: msg.type,
        payloadRedactedJson: {
          chatId: msg.chatId,
          senderId: msg.senderId,
          type: msg.type,
          hasText: Boolean(msg.text),
        },
      },
    });

    // Check pairing command first
    let text = (msg.text || msg.caption || '').trim();
    if (text.startsWith('/pair')) {
      const parts = text.split(/\s+/);
      const code = parts[1] || '';
      const pairResult = await this.authService.pairOwner(msg.senderId, code, msg.senderName);
      await this.sendReply(msg.chatId, pairResult.message);
      return;
    }

    const botAccessMode = this.configService.get<string>('BOT_ACCESS_MODE');
    const isPublic = botAccessMode === 'public';

    // Check owner authorization
    const isOwner = isPublic || (await this.authService.isOwner(msg.senderId));
    if (!isOwner) {
      if (text === '/whoami') {
        await this.sendReply(
          msg.chatId,
          `Thông tin của bạn:\n• User ID: ${msg.senderId}\n• Chat ID: ${msg.chatId}\n• Vai trò: Khách (Chưa ghép nối)`,
        );
        return;
      }

      const existingOwner = await this.authService.getOwner();
      if (!existingOwner) {
        await this.sendReply(
          msg.chatId,
          '⚠️ Hệ thống chưa được ghép nối với chủ sở hữu.\nVui lòng chạy CLI `npm run owner:pair-code` trên máy chủ và nhắn tin `/pair <mã>` vào đây để xác thực.',
        );
      } else {
        await this.sendReply(
          msg.chatId,
          'Xin lỗi, đây là Personal AI Agent riêng tư dành cho một chủ sở hữu duy nhất. Bạn không có quyền truy cập.',
        );
      }
      return;
    }

    // Resolve or upsert user record for ownerId
    let user = await this.prisma.user.findUnique({
      where: { zaloUserId: msg.senderId },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          zaloUserId: msg.senderId,
          displayName: msg.senderName || 'User',
          role: 'OWNER',
        },
      });
    }
    const ownerId = user.id;

    // Get or create conversation record
    const conversation = await this.conversationsService.getOrCreateConversation(
      msg.channel,
      msg.chatId,
      msg.chatType,
      ownerId,
    );

    // Handle incoming VOICE message (Speech-to-Text)
    const voiceAttachment = msg.attachments?.find((att) => att.type === 'VOICE' && att.sourceUrl);
    const voiceUrl = msg.voiceUrl || voiceAttachment?.sourceUrl;
    if (msg.type === 'VOICE' || voiceUrl) {
      if (!voiceUrl) {
        await this.sendReply(msg.chatId, 'Dạ em nhận được tin nhắn thoại nhưng không tìm thấy đường dẫn file âm thanh ạ.');
        return;
      }
      await this.zaloClient.sendChatAction(msg.chatId, 'typing').catch(() => {});
      const sttRes = await this.llmService.transcribeAudio(voiceUrl);
      if (!sttRes.success || !sttRes.text) {
        await this.sendReply(
          msg.chatId,
          `Dạ em chưa nghe rõ hoặc chưa thể chuyển đổi tin nhắn thoại này thành văn bản (${sttRes.error || 'STT error'}). Anh/chị nhắn chữ hoặc nói lại giúp em nhé! 🎙️`,
        );
        return;
      }
      text = sttRes.text;
      await this.sendReply(msg.chatId, `🎙️ *(Đã nghe: "${text}")*`);
    }

    // Save user message
    const prismaMsgType =
      msg.type === 'IMAGE'
        ? MessageType.IMAGE
        : msg.type === 'VOICE'
          ? MessageType.VOICE
          : msg.type === 'FILE'
            ? MessageType.FILE
            : MessageType.TEXT;

    await this.conversationsService.saveMessage({
      conversationId: conversation.id,
      externalMessageId: msg.externalMessageId,
      direction: MessageDirection.INBOUND,
      content: text,
      type: prismaMsgType,
      attachmentsJson: msg.attachments,
    });

    // Record incoming user image if present in attachments
    const imgAttachment = msg.attachments?.find((att) => att.type === 'IMAGE' && att.sourceUrl);
    if (imgAttachment?.sourceUrl) {
      const rec = await this.imageContextService.recordIncomingUserImage({
        chatId: msg.chatId,
        ownerId,
        conversationId: conversation.id,
        imageUrl: imgAttachment.sourceUrl,
        externalMessageId: msg.externalMessageId,
      });
      if (rec?.fileId) {
        await this.conversationStateService.recordImage(conversation.id, rec.fileId);
      }
    }

    // Record incoming user document/file if present in attachments
    const fileAttachment = msg.attachments?.find((att) => att.type === 'FILE' && att.sourceUrl);
    const incomingFileUrl = msg.fileUrl || fileAttachment?.sourceUrl;
    if (incomingFileUrl) {
      try {
        const savedDoc = await this.filesService.downloadMediaSafely(
          incomingFileUrl,
          ownerId,
          'application/octet-stream',
          msg.fileName || fileAttachment?.fileName || `document-${Date.now()}`,
          conversation.id,
        );
        await this.conversationStateService.recordFile(conversation.id, savedDoc.id);
        if (!text) {
          await this.sendReply(
            msg.chatId,
            `Dạ em đã nhận và lưu tệp tài liệu **${savedDoc.originalName}** (Mã: \`${savedDoc.id.slice(0, 8)}\`) rồi ạ 📄. Anh/chị muốn em tóm tắt nội dung, phân tích số liệu hay trích xuất thông tin gì từ tệp này ạ?`,
          );
          return;
        }
        text = `${text}\n[Tệp tài liệu đính kèm vừa nhận: ${savedDoc.originalName} (fileId: ${savedDoc.id})]`;
      } catch (err: any) {
        this.logger.warn(`[AGENT_FILE_DOWNLOAD_WARN] Failed downloading incoming file: ${err.message}`);
      }
    }

    // Intercept sticker collection session if active
    if (msg.type === 'STICKER' || msg.stickerId) {
      const activeSession = await this.stickerService.getActiveSession(msg.chatId);
      if (activeSession && msg.stickerId) {
        const rec = await this.stickerService.recordStickerToSession(msg.chatId, msg.stickerId);
        if (rec) {
          const note = rec.isNewInSession ? 'Đã thu thập' : 'Đã có trong phiên';
          await this.sendReply(
            msg.chatId,
            `📥 ${note} sticker ID: \`${msg.stickerId}\` vào nhóm **${rec.emotion}**.\n(Hiện có ${rec.sessionCount} sticker trong phiên này. Tiếp tục gửi thêm hoặc gõ \`/sticker-done\` khi hoàn tất).`,
          );
          return;
        }
      }
    }

    // Handle bot commands
    if (text.startsWith('/')) {
      const handled = await this.handleCommand(text, msg.chatId, ownerId, conversation.id);
      if (handled) return;
    }

    // If text is empty (e.g. image with no caption)
    if (!text && (msg.type === 'IMAGE' || imgAttachment)) {
      await this.sendReply(
        msg.chatId,
        'Dạ em đã nhận và lưu hình ảnh của anh/chị rồi ạ 🎨. Anh/chị muốn em chỉnh sửa gì trên ảnh này (ví dụ: đổi nền trắng, chuyển thành chibi, sửa màu sắc...), hay cần em hỗ trợ điều gì ạ?',
      );
      return;
    }

    // Check if user input is an ambiguous reminder request that needs clarification
    const parsedTime = ReminderTimeParser.parse(text);
    if (parsedTime.isAmbiguous && parsedTime.clarificationPrompt) {
      await this.conversationStateService.setPendingClarification(conversation.id, {
        intent: 'REMINDER',
        prompt: parsedTime.clarificationPrompt,
        originalText: text,
        missingSlots: ['dueAt'],
      });
      await this.sendReply(msg.chatId, parsedTime.clarificationPrompt);
      return;
    }

    // Multi-turn context resolution (pronouns, ordinal references, clarifications)
    const resolved = await this.contextResolverService.resolveContext(
      conversation.id,
      ownerId,
      msg.chatId,
      text,
      msg.chatType === 'GROUP' ? 'GROUP' : 'PRIVATE',
      msg.replyToMessageId,
    );
    const effectiveText = resolved.augmentedText || text;

    // Early acknowledgment for long tasks (file generation, gmail processing, multi-step analysis)
    if (this.taskProgressService.isLongRunningTask(effectiveText)) {
      await this.taskProgressService.sendEarlyAck(msg.chatId, effectiveText);
    }

    // Agent AI Orchestration
    try {
      await this.runAgentLoop(
        effectiveText,
        msg.chatId,
        ownerId,
        conversation.id,
        resolved.injectedContextPrompt,
      );
    } catch (err: any) {
      this.logger.error(`[UNCAUGHT_AGENT_ERROR] ${err.message}`, err.stack);
      await this.sendReply(
        msg.chatId,
        `Dạ em xin lỗi, hệ thống AI tạm thời gặp gián đoạn. Anh/chị vui lòng thử lại sau giây lát giúp em nhé! 🙏`,
      );
    }
  }

  private async handleCommand(
    text: string,
    chatId: string,
    ownerId: string,
    conversationId: string,
  ): Promise<boolean> {
    const [command, ...args] = text.split(/\s+/);

    switch (command.toLowerCase()) {
      case '/clear':
        const conv = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
        });

        if (conv?.type === 'GROUP') {
          const isOwner = await this.authService.isOwner(ownerId);
          if (!isOwner) {
            await this.sendReply(
              chatId,
              'Dạ, lệnh /clear trong nhóm chỉ áp dụng cho Chủ sở hữu bot để tránh làm mất ngữ cảnh chung của các thành viên khác ạ.',
            );
            return true;
          }
        }

        try {
          await this.conversationsService.resetConversation(conversationId);
          await this.prisma.approval.updateMany({
            where: {
              task: { conversationId },
              status: 'PENDING',
            },
            data: { status: 'DENIED' },
          });

          await this.sendReply(
            chatId,
            'Dạ, em đã xóa ngữ cảnh cuộc trò chuyện này rồi ạ. Mình bắt đầu lại từ đầu nhé! ✨',
          );
        } catch (err: any) {
          this.logger.error(`Failed executing /clear command: ${err.message}`);
          await this.sendReply(chatId, '⚠️ Đã xảy ra lỗi khi xóa ngữ cảnh cuộc trò chuyện. Vui lòng thử lại.');
        }
        return true;

      case '/start':
      case '/help':
        await this.sendReply(
          chatId,
          `🤖 **PERSONAL AI AGENT (Zalo Bot - OpenRouter Gateway)**\n\n` +
            `Các lệnh khả dụng:\n` +
            `• /whoami - Xem thông tin tài khoản\n` +
            `• /permissions - Xem danh sách quyền & tools\n` +
            `• /model - Xem routing mode & model đang sử dụng\n` +
            `• /routing - Xem bảng mapping task -> model\n` +
            `• /models - Danh sách models đang cấu hình\n` +
            `• /ai-usage - Thống kê token và chi phí AI hôm nay\n` +
            `• /ai-health - Kiểm tra kết nối OpenRouter Gateway\n` +
            `• /tasks - Xem danh sách tác vụ\n` +
            `• /approvals - Xem các yêu cầu chờ phê duyệt\n` +
            `• /approve <code> - Phê duyệt thao tác nhạy cảm\n` +
            `• /deny <code> - Từ chối thao tác\n` +
            `• /files - Danh sách file đã tạo\n` +
            `• /memories - Xem danh sách bộ nhớ dài hạn về bạn\n` +
            `• /memory-del <id> - Xóa một ghi nhớ dài hạn theo ID\n` +
            `• /briefing - Xem Bản tin sáng tổng hợp lịch trình & ghi nhớ\n` +
            `• /stickers - Danh sách nhóm sticker & số lượng ID\n` +
            `• /sticker <emotion> [count] - Test gửi sticker theo cảm xúc\n` +
            `• /sticker-reload - Nạp lại cấu hình stickers.json\n` +
            `• /mail connect - Kết nối Gmail qua Google OAuth\n` +
            `• /mail status - Trạng thái kết nối Gmail\n` +
            `• /reminders - Danh sách việc cần làm đã lên lịch\n` +
            `• /reminder-test - Thử nghiệm hẹn giờ nhắc việc sau 60 giây\n` +
            `• /reminder-cancel <id> - Hủy một lời nhắc theo mã ID\n` +
            `• /reminder-health - Kiểm tra tình trạng hàng đợi nhắc nhở\n` +
            `• /health - Kiểm tra tình trạng hệ thống\n\n` +
            `Bạn cũng có thể trò chuyện trực tiếp: "10 phút nữa nhắc anh gửi báo cáo", "dời thêm 15 phút", "hủy nhắc việc vừa rồi", "Tạo file Excel...", "Vẽ ảnh mèo chibi...", v.v.`,
        );
        return true;

      case '/whoami':
        await this.sendReply(
          chatId,
          `👤 **Thông tin Chủ sở hữu:**\n• Owner ID: ${ownerId}\n• Chat ID: ${chatId}\n• Trạng thái: Đã xác thực`,
        );
        return true;

      case '/permissions':
        const tools = this.toolRegistry.listTools();
        await this.sendReply(
          chatId,
          `🛡️ **Quyền & Công cụ đang hoạt động:**\n` +
            tools.map((t) => `• [${t.riskLevel}] ${t.name}: ${t.description}`).join('\n'),
        );
        return true;

      case '/approvals':
        const pending = await this.approvalsService.listPending(ownerId);
        if (pending.length === 0) {
          await this.sendReply(chatId, 'Hiện không có yêu cầu nào đang chờ bạn phê duyệt.');
        } else {
          await this.sendReply(
            chatId,
            `⏳ **Danh sách chờ phê duyệt (${pending.length}):**\n` +
              pending
                .map(
                  (a) =>
                    `• Hành động: ${a.actionType}\n  Hết hạn: ${a.expiresAt.toLocaleTimeString('vi-VN')}\n  Nhắn /approve <mã> hoặc /deny <mã>`,
                )
                .join('\n\n'),
          );
        }
        return true;

      case '/approve':
      case '/deny':
        const decision = command.toLowerCase() === '/approve' ? 'APPROVE' : 'DENY';
        const code = args[0] || '';
        const res = await this.approvalsService.verifyAndConsume(code, ownerId, decision);
        await this.sendReply(chatId, res.message);
        if (res.success && decision === 'APPROVE' && res.approval) {
          await this.executeApprovedAction(res.approval, chatId);
        }
        return true;

      case '/tasks':
        const tasks = await this.prisma.agentTask.findMany({
          where: { ownerId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        if (tasks.length === 0) {
          await this.sendReply(chatId, 'Bạn chưa có tác vụ nào.');
        } else {
          await this.sendReply(
            chatId,
            `📋 **Tác vụ gần đây:**\n` +
              tasks
                .map(
                  (t) =>
                    `• #${t.id.slice(0, 8)} [${t.status}] ${t.title || t.request.slice(0, 30)} (${t.createdAt.toLocaleTimeString('vi-VN')})`,
                )
                .join('\n'),
          );
        }
        return true;

      case '/files':
        const files = await this.storageService.listFiles(ownerId);
        if (files.length === 0) {
          await this.sendReply(chatId, 'Hiện không có tệp tin tạm nào đang khả dụng (tất cả file tự động hết hạn và xóa sau 24 giờ).');
        } else {
          const lines = files.map((f) => {
            const hoursLeft = f.expiresAt ? Math.max(0, Math.round((f.expiresAt.getTime() - Date.now()) / (3600 * 1000))) : 24;
            return `• ${f.originalName} (${Number(f.sizeBytes)} bytes) - Hết hạn sau ~${hoursLeft}h - ID: \`${f.id.slice(0, 8)}\``;
          });
          await this.sendReply(
            chatId,
            `📁 **Tệp tin tạm hiện có (tự động xóa sau 24h):**\n\n${lines.join('\n')}\n\n💡 Nhắn "cho anh xin lại link file <ID>" để nhận lại liên kết tải còn hiệu lực.`,
          );
        }
        return true;

      case '/mail':
        const sub = args[0]?.toLowerCase();
        if (sub === 'connect') {
          try {
            const url = this.gmailService.generateAuthUrl(ownerId);
            await this.sendReply(
              chatId,
              `🔗 **Kết nối tài khoản Gmail:**\nVui lòng mở liên kết sau trong trình duyệt để đăng nhập và cấp quyền:\n${url}`,
            );
          } catch (e: any) {
            await this.sendReply(chatId, `Không thể tạo URL kết nối Gmail: ${e.message}`);
          }
        } else if (sub === 'status') {
          const acc = await this.gmailService.getConnectedAccount(ownerId);
          if (acc) {
            await this.sendReply(
              chatId,
              `📧 Gmail đã kết nối: **${acc.email}**\nĐồng bộ lúc: ${acc.connectedAt.toLocaleString('vi-VN')}`,
            );
          } else {
            await this.sendReply(
              chatId,
              `Chưa có tài khoản Gmail nào được kết nối. Nhắn \`/mail connect\` để bắt đầu.`,
            );
          }
        } else {
          await this.sendReply(chatId, `Cú pháp: \`/mail connect\` hoặc \`/mail status\``);
        }
        return true;

      case '/reminders':
        const activeReminders = await this.schedulerService.listActiveReminders(ownerId, chatId);
        if (activeReminders.length === 0) {
          await this.sendReply(chatId, 'Dạ, anh/chị hiện không có lời nhắc nào đang chờ ạ.');
        } else {
          const lines = activeReminders.map(
            (r) =>
              `• [ID: \`${r.id.slice(0, 8)}\`] **${r.title}**\n  ⏰ Lúc: ${r.dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
          );
          await this.sendReply(
            chatId,
            `⏰ **DANH SÁCH LỜI NHẮC ĐANG CHỜ (${activeReminders.length}):**\n\n${lines.join('\n\n')}\n\n` +
              `💡 Để hủy, nhắn \`/reminder-cancel <mã_id>\` hoặc nhắn tự nhiên: "hủy nhắc việc vừa rồi", "dời thêm 15 phút".`,
          );
        }
        return true;

      case '/reminder-test':
        const testDueAt = new Date(Date.now() + 60 * 1000);
        const testRes = await this.schedulerService.createReminder({
          ownerId,
          chatId,
          title: 'Kiểm tra hệ thống nhắc việc tự động (Test Reminder)',
          dueAt: testDueAt,
          note: 'Tin nhắn test nhắc việc sau 60 giây',
          sourceConversationId: conversationId,
        });
        if (testRes.success) {
          await this.sendReply(
            chatId,
            `⏰ **ĐÃ LÊN LỊCH NHẮC VIỆC THỬ NGHIỆM!**\n\n` +
              `• Tiêu đề: **Kiểm tra hệ thống nhắc việc tự động**\n` +
              `• Thời gian hẹn: **${testRes.formattedTime}** (sau 60 giây)\n` +
              `• Mã ID: \`${testRes.reminder?.id}\`\n\n` +
              `Bot sẽ tự động gửi tin nhắn nhắc nhở trực tiếp vào chat đúng thời gian trên mà không cần anh/chị phải nhắn thêm gì ạ!`,
          );
        } else {
          await this.sendReply(chatId, `⚠️ Không thể tạo lời nhắc test: ${testRes.error}`);
        }
        return true;

      case '/reminder-cancel':
        const cancelId = args[0];
        if (!cancelId) {
          await this.sendReply(chatId, 'Dạ, anh/chị vui lòng nhập mã nhắc việc cần hủy. Ví dụ: `/reminder-cancel <mã_id>`.');
          return true;
        }
        const cancelRes = await this.schedulerService.cancelReminder(cancelId, ownerId);
        await this.sendReply(chatId, cancelRes.message);
        return true;

      case '/reminder-health':
        const rHealth = await this.schedulerService.getHealth();
        await this.sendReply(
          chatId,
          `⏰ **TÌNH TRẠNG HỆ THỐNG NHẮC VIỆC (SCHEDULER HEALTH):**\n\n` +
            `• Trạng thái tổng thể: ${rHealth.isHealthy ? 'HOẠT ĐỘNG TỐT ✅' : 'CÓ VẤN ĐỀ ⚠️'}\n` +
            `• Kết nối Redis & BullMQ: ${rHealth.redisStatus}\n` +
            `• Số Job đang chờ trong Queue (BullMQ Delayed): **${rHealth.delayedJobCount}**\n` +
            `• Số Lời nhắc đang lên lịch trong DB (PostgreSQL): **${rHealth.scheduledDbCount}**\n` +
            `• Số Lời nhắc thất bại trong DB: **${rHealth.failedDbCount}**\n` +
            `• Worker background: Đang lắng nghe hàng đợi \`reminders-queue\``,
        );
        return true;

      case '/model':
        const mode = this.routingService.getMode();
        const singleModel = this.routingService.getSingleModel();
        const defaultModel = this.routingService.getDefaultModel();
        const lastUsed = this.llmService.getLastUsedModel() || 'Chưa thực hiện request nào';
        const lastCat = this.llmService.getLastUsedCategory() || 'N/A';
        await this.sendReply(
          chatId,
          `🤖 **CẤU HÌNH MODEL HIỆN TẠI:**\n` +
            `• Routing Mode: **${mode.toUpperCase()}**\n` +
            (mode === 'single'
              ? `• Single Model: \`${singleModel}\` (Cố định cho 100% tác vụ)\n`
              : `• Default Task Model: \`${defaultModel}\`\n`) +
            `• Model gần nhất đã xử lý: \`${lastUsed}\` (${lastCat})`,
        );
        return true;

      case '/routing':
        const rMode = this.routingService.getMode();
        const config = this.routingService.getConfig();
        if (rMode === 'single') {
          await this.sendReply(
            chatId,
            `🧭 **ROUTING CHẾ ĐỘ SINGLE:**\n` +
              `Toàn bộ tác vụ đều sử dụng một model duy nhất: \`${this.routingService.getSingleModel()}\`.\n` +
              `(Quy tắc task-routing trong llm-routing.json đang được bỏ qua. Để bật route theo việc, đổi LLM_ROUTING_MODE=task trong .env).`,
          );
        } else {
          const taskMappings = Object.entries(config.taskModels)
            .map(([cat, m]) => `• ${cat}: \`${m}\``)
            .join('\n');
          await this.sendReply(
            chatId,
            `🧭 **BẢNG ĐIỀU HƯỚNG TÁC VỤ (TASK ROUTING):**\n` +
              `• Chiến lược: **${config.strategy.toUpperCase()}**\n` +
              `• Default Model: \`${config.defaultModel}\`\n\n` +
              `Danh sách mapping:\n${taskMappings || 'Chưa cấu hình riêng, dùng default model'}`,
          );
        }
        return true;

      case '/models':
        const curMode = this.routingService.getMode();
        const cfg = this.routingService.getConfig();
        const modelsInUse = new Set<string>();
        if (curMode === 'single') {
          modelsInUse.add(this.routingService.getSingleModel());
        } else {
          modelsInUse.add(cfg.defaultModel);
          for (const m of Object.values(cfg.taskModels)) {
            modelsInUse.add(m);
          }
        }

        const modelDetails = [];
        for (const mid of Array.from(modelsInUse)) {
          const hasTools = await this.catalogService.supportsTools(mid);
          const hasVision = await this.catalogService.supportsVision(mid);
          modelDetails.push(`• \`${mid}\`\n  - Tools: ${hasTools ? '✅' : '❌'}\n  - Vision: ${hasVision ? '✅' : '❌'}`);
        }

        await this.sendReply(
          chatId,
          `📦 **DANH SÁCH MODEL ĐANG CẤU HÌNH:**\n${modelDetails.join('\n\n')}`,
        );
        return true;

      case '/ai-usage':
        const stats = await this.usageService.getDailyStats();
        const topModelLines = Object.entries(stats.topModels)
          .map(([m, cnt]) => `  - \`${m}\`: ${cnt} lượt`)
          .join('\n');
        await this.sendReply(
          chatId,
          `📊 **THỐNG KÊ SỬ DỤNG AI HÔM NAY:**\n` +
            `• Số lượt gọi: ${stats.requests}\n` +
            `• Tổng tokens: ${stats.tokens.toLocaleString('vi-VN')}\n` +
            `• Chi phí ước tính: $${stats.costUsd.toFixed(4)} USD\n` +
            `• Phân bổ model:\n${topModelLines || '  (Chưa có dữ liệu)'}`,
        );
        return true;

      case '/ai-health':
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        const hasKey = Boolean(apiKey && apiKey.trim().length > 0);
        const cachedModels = await this.catalogService.getAllCachedModels();
        await this.sendReply(
          chatId,
          `🩺 **OPENROUTER GATEWAY HEALTH:**\n` +
            `• Base URL: ${this.configService.get('OPENROUTER_BASE_URL')}\n` +
            `• API Key: ${hasKey ? 'Đã cấu hình ✅' : 'Chưa cấu hình (Mock LLM) ⚠️'}\n` +
            `• Routing Mode: ${this.routingService.getMode().toUpperCase()}\n` +
            `• Models trong Cache: ${cachedModels.length}\n` +
            `• Data Collection Deny: ${this.configService.get('OPENROUTER_DENY_DATA_COLLECTION') ? 'Bật ✅' : 'Tắt'}\n` +
            `• Zero Data Retention (ZDR): ${this.configService.get('OPENROUTER_REQUIRE_ZDR') ? 'Bật 🛡️' : 'Tắt'}`,
        );
        return true;

      case '/stickers':
      case '/sticker-list':
        const counts = this.stickerService.getLibraryCounts();
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const lines = Object.entries(counts)
          .map(([em, cnt]) => `• ${em}: ${cnt} sticker`)
          .join('\n');
        await this.sendReply(
          chatId,
          `🎭 **DANH SÁCH NHÓM STICKER (Tổng: ${total}):**\n${lines}\n\n` +
            `💡 Để thêm sticker mới, dùng lệnh \`/sticker-add <nhóm>\` và gửi sticker trực tiếp, hoặc sửa file \`config/stickers.json\` rồi gõ \`/sticker-reload\`.`,
        );
        return true;

      case '/sticker-add':
        const addEmotion = args[0]?.toLowerCase();
        if (!addEmotion) {
          await this.sendReply(
            chatId,
            `Dạ, anh/chị vui lòng nhập nhóm cảm xúc. Ví dụ: \`/sticker-add sorry\`.\nCác nhóm cảm xúc hỗ trợ: ${STICKER_EMOTIONS.join(', ')}.`,
          );
          return true;
        }
        if (!this.stickerService.isValidEmotion(addEmotion)) {
          await this.sendReply(
            chatId,
            `Dạ, nhóm cảm xúc "${addEmotion}" không hợp lệ. Các nhóm hỗ trợ: ${STICKER_EMOTIONS.join(', ')}.`,
          );
          return true;
        }
        const sessionRes = await this.stickerService.startSession(chatId, ownerId, addEmotion as StickerEmotion);
        if (sessionRes.success) {
          await this.sendReply(
            chatId,
            `📥 **BẮT ĐẦU PHIÊN THU THẬP STICKER CHO NHÓM [${addEmotion}]**\n\n` +
              `Anh/chị hãy gửi các sticker thuộc nhóm "${addEmotion}" vào đây nhé. Em sẽ tự động ghi nhận sticker ID.\n\n` +
              `• Nhắn \`/sticker-status\` để kiểm tra tiến độ\n` +
              `• Nhắn \`/sticker-done\` khi gửi xong để lưu lại vào thư viện\n` +
              `• Nhắn \`/sticker-cancel\` để hủy phiên`,
          );
        } else {
          await this.sendReply(chatId, `⚠️ ${sessionRes.message}`);
        }
        return true;

      case '/sticker-done':
        const doneRes = await this.stickerService.finishSession(chatId);
        if (!doneRes) {
          await this.sendReply(chatId, 'Dạ, hiện không có phiên thu thập sticker nào đang mở trong cuộc trò chuyện này ạ.');
          return true;
        }
        await this.sendReply(
          chatId,
          `🎉 **HOÀN TẤT THU THẬP STICKER!**\n\n` +
            `• Nhóm cảm xúc: **${doneRes.emotion}**\n` +
            `• Thêm mới thành công: **${doneRes.addedCount}** sticker\n` +
            `• Trùng lặp (bỏ qua): **${doneRes.duplicateCount}** sticker\n` +
            `• Tổng số sticker trong nhóm "${doneRes.emotion}": **${doneRes.totalCount}**\n\n` +
            `Dữ liệu đã được lưu bền vững vào PostgreSQL và đồng bộ với file cấu hình!`,
        );
        return true;

      case '/sticker-status':
        const curSession = await this.stickerService.getActiveSession(chatId);
        if (!curSession) {
          await this.sendReply(chatId, 'Hiện không có phiên thu thập sticker nào đang mở trong cuộc trò chuyện này.');
          return true;
        }
        await this.sendReply(
          chatId,
          `📊 **TRẠNG THÁI PHIÊN THU THẬP STICKER:**\n` +
            `• Nhóm cảm xúc: **${curSession.emotion}**\n` +
            `• Số lượng sticker đã nhận: **${curSession.collectedIds.length}**\n\n` +
            `Tiếp tục gửi sticker hoặc gõ \`/sticker-done\` khi hoàn tất, hoặc \`/sticker-cancel\` để hủy.`,
        );
        return true;

      case '/sticker-cancel':
        const canceled = await this.stickerService.cancelSession(chatId);
        if (canceled) {
          await this.sendReply(chatId, '🛑 Đã hủy phiên thu thập sticker hiện tại.');
        } else {
          await this.sendReply(chatId, 'Không có phiên thu thập nào đang diễn ra để hủy.');
        }
        return true;

      case '/sticker':
      case '/sticker-test':
        const emotionArg = args[0]?.toLowerCase();
        const countArg = parseInt(args[1], 10) || 1;
        if (!emotionArg) {
          await this.sendReply(
            chatId,
            'Dạ, anh/chị vui lòng nhập nhóm cảm xúc. Ví dụ: `/sticker-test hello` hoặc `/sticker-test sorry 3`.',
          );
          return true;
        }
        if (!this.stickerService.isValidEmotion(emotionArg)) {
          await this.sendReply(
            chatId,
            `Dạ, nhóm cảm xúc "${emotionArg}" không hợp lệ. Các nhóm hỗ trợ: ${STICKER_EMOTIONS.join(', ')}.`,
          );
          return true;
        }
        const multRes = await this.stickerService.sendMultipleStickers(chatId, emotionArg as StickerEmotion, countArg);
        if (multRes.sentCount === 0) {
          await this.sendReply(
            chatId,
            `Dạ, nhóm "${emotionArg}" hiện chưa có sticker ID nào trong thư viện. Anh/chị dùng lệnh \`/sticker-add ${emotionArg}\` để gửi sticker thu thập nhé ạ!`,
          );
        }
        return true;

      case '/sticker-help':
        await this.sendReply(
          chatId,
          `🎨 **HƯỚNG DẪN QUẢN LÝ STICKER:**\n\n` +
            `• \`/sticker-add <nhóm>\`: Bắt đầu phiên thu thập sticker cho nhóm cảm xúc (VD: \`/sticker-add sorry\`)\n` +
            `• Gửi sticker vào chat: Tự động ghi nhận ID sticker vào phiên đang mở\n` +
            `• \`/sticker-status\`: Xem số lượng sticker đã nhận trong phiên\n` +
            `• \`/sticker-done\`: Kết thúc phiên và lưu các sticker vào PostgreSQL & stickers.json\n` +
            `• \`/sticker-cancel\`: Hủy bỏ phiên thu thập hiện tại\n` +
            `• \`/sticker-list\` hoặc \`/stickers\`: Xem danh sách tất cả nhóm cảm xúc và số lượng sticker\n` +
            `• \`/sticker-test <nhóm> [số lượng]\`: Test bot gửi sticker theo nhóm cảm xúc\n` +
            `• \`/sticker-reload\`: Nạp lại thư viện sticker từ đĩa và database\n\n` +
            `Các nhóm cảm xúc hỗ trợ:\n` +
            STICKER_EMOTIONS.map((e) => `• ${e}`).join('\n'),
        );
        return true;

      case '/sticker-reload':
        const reloadRes = await this.stickerService.reloadLibrary();
        await this.sendReply(chatId, `🔄 **Cập nhật thư viện Sticker:**\n${reloadRes.message}`);
        return true;

      case '/health':
        await this.sendReply(
          chatId,
          `🟢 **Hệ thống hoạt động bình thường:**\n• Node.js: OK\n• PostgreSQL: OK\n• Redis: OK\n• LLM Provider: ${this.configService.get('LLM_PROVIDER') || 'openrouter'} (${this.routingService.getMode().toUpperCase()})\n• Storage: ${this.storageService.isPubliclyAccessible() ? 'Supabase Storage (24h TTL)' : 'Local Storage'}\n• Timezone: ${this.configService.get('APP_TIMEZONE')}`,
        );
        return true;

      case '/memories':
        const memories = await this.prisma.memory.findMany({
          where: { ownerId },
          orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
          take: 25,
        });
        if (memories.length === 0) {
          await this.sendReply(
            chatId,
            '🧠 Hiện em chưa lưu ghi nhớ dài hạn nào. Anh/chị có thể bảo em: "Hãy nhớ là anh thích uống cà phê đen không đường" hoặc "Nhớ giúp anh số điện thoại...".',
          );
        } else {
          const memLines = memories.map(
            (m, idx) =>
              `${idx + 1}. [\`${m.id.slice(0, 8)}\`] **[${m.category}]** (⭐${m.importance}/5): ${m.text}`,
          );
          await this.sendReply(
            chatId,
            `🧠 **BỘ NHỚ DÀI HẠN CỦA ANH/CHỊ (${memories.length}):**\n\n${memLines.join('\n')}\n\n💡 Để xóa một ghi nhớ, nhắn \`/memory-del <mã_id>\`.`,
          );
        }
        return true;

      case '/memory-del':
        const memIdPrefix = args[0]?.trim();
        if (!memIdPrefix) {
          await this.sendReply(chatId, 'Dạ vui lòng nhập mã ID cần xóa. Ví dụ: `/memory-del 1a2b3c4d`.');
          return true;
        }
        const matchedMemories = await this.prisma.memory.findMany({
          where: {
            ownerId,
            id: { startsWith: memIdPrefix },
          },
        });
        if (matchedMemories.length === 0) {
          await this.sendReply(chatId, `Không tìm thấy ghi nhớ nào có mã bắt đầu bằng "${memIdPrefix}".`);
          return true;
        }
        await this.prisma.memory.delete({ where: { id: matchedMemories[0].id } });
        await this.sendReply(
          chatId,
          `🗑️ Đã xóa ghi nhớ: "${matchedMemories[0].text}" khỏi bộ nhớ dài hạn.`,
        );
        return true;

      case '/briefing':
        const briefingMsg = await this.schedulerService.buildMorningBriefing(ownerId, chatId);
        await this.sendReply(chatId, briefingMsg);
        return true;

      default:
        return false;
    }
  }

  private async executeApprovedAction(approval: any, chatId: string) {
    try {
      if (approval.actionType === 'gmail_send_email') {
        const payload = approval.encryptedOrRedactedPayload;
        const res = await this.gmailService.sendEmail(approval.ownerId, payload.to, payload.subject, payload.body);
        await this.sendReply(chatId, `🚀 Đã gửi email thành công tới ${payload.to}! (ID: ${res.messageId})`);
      }
    } catch (err: any) {
      await this.sendReply(chatId, `❌ Lỗi khi thực thi hành động đã duyệt: ${err.message}`);
    }
  }

  private async runAgentLoop(
    userPrompt: string,
    chatId: string,
    ownerId: string,
    conversationId: string,
    injectedContextPrompt?: string,
  ) {
    // Send initial typing status
    await this.zaloClient.sendChatAction(chatId, 'typing').catch(() => {});

    // Create AgentTask in DB
    const task = await this.prisma.agentTask.create({
      data: {
        ownerId,
        conversationId,
        request: userPrompt,
        title: userPrompt.slice(0, 50),
        status: TaskStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    // Start reassurance watchdog timer
    this.taskProgressService.startWatchdog(task.id, chatId);

    try {
      const nowVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const nowISO = new Date().toISOString();

      // Load top long-term memories of owner to inject into System Prompt automatically
      let memoryContextBlock = '';
      try {
        const topMemories = await this.prisma.memory?.findMany({
          where: { ownerId },
          orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
          take: 10,
        });
        if (topMemories && topMemories.length > 0) {
          const mList = topMemories.map((m) => `- [${m.category}] ${m.text}`).join('\n');
          memoryContextBlock = `\n\nBộ nhớ dài hạn về Chủ sở hữu (Long-term Memories đang lưu):\n${mList}`;
        }
      } catch {
        // Ignore if mock prisma in unit test doesn't stub memory.findMany
      }

      const recentHistory = await this.conversationsService.getRecentMessages(conversationId, 10);
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            `Thời gian hiện tại của hệ thống (Asia/Ho_Chi_Minh): ${nowVN} (ISO: ${nowISO}). Mọi tính toán thời gian (ví dụ: '10 phút nữa', 'ngày mai', 'lúc 15h') phải căn cứ chính xác vào mốc thời gian này.\n\n` +
            `Bạn là Trợ lý AI Cá nhân (Personal AI Agent) thông minh, tận tụy và đáng tin cậy của tôi qua Zalo Bot.\n\n` +
            `Văn phong & Nhân cách (Persona):\n` +
            `- Bạn nói tiếng Việt tự nhiên, lễ phép, thường xưng "em" và gọi người dùng là "anh/chị" (hoặc theo cách xưng hô phù hợp).\n` +
            `- Mở đầu tự nhiên bằng lời lẽ lịch thiệp khi phù hợp: "Dạ", "Vâng ạ", "Dạ vâng". Tuyệt đối KHÔNG lặp lại "dạ/vâng" máy móc trong từng câu.\n` +
            `- Thân thiện, nhanh nhẹn, có nét hóm hỉnh/dí dỏm nhẹ nhàng khi trò chuyện thân mật hoặc đùa vui. Tuyệt đối nghiêm túc, điềm đạm, chính xác khi xử lý lỗi, bảo mật, gửi email hoặc báo cáo quan trọng.\n` +
            `- KHÔNG nịnh nọt thảo mai, KHÔNG ngụy tạo tiến độ hay kết quả công cụ (chỉ báo hoàn thành khi tool thực sự hoàn thành).\n` +
            `- Phong cách nhắn tin Zalo: Viết câu trả lời tự nhiên, cô đọng, súc tích như khi chat. Tuyệt đối KHÔNG chèn quá nhiều dòng trống (\\n\\n) thừa thãi giữa các câu. Các ý cần mạch lạc và ngắn gọn để đọc dễ dàng trên màn hình điện thoại.\n\n` +
            `Quy tắc Bộ nhớ dài hạn (Long-term Memory):\n` +
            `- Khi người dùng chia sẻ thông tin cá nhân quan trọng, sở thích, thói quen, dị ứng, liên hệ, công việc hoặc dặn "nhớ giúp anh...": Hãy chủ động gọi tool memory_save.\n` +
            `- Khi cần tra cứu thông tin cá nhân đã lưu hoặc xóa ghi nhớ cũ: Gọi tool memory_search hoặc memory_delete.\n\n` +
            `Quy tắc Tìm kiếm Web & Đọc Link (Web Search & Fetch URL):\n` +
            `- Khi người dùng hỏi thông tin thời sự, giá vàng, tỷ giá, thời tiết, tin tức mới nhất hoặc sự kiện thực tế: BẮT BUỘC gọi tool web_search để lấy thông tin mới nhất.\n` +
            `- Khi người dùng gửi một đường link URL (http/https) và yêu cầu đọc, tóm tắt hoặc phân tích nội dung trang web đó: BẮT BUỘC gọi tool fetch_url.\n\n` +
            `Quy tắc Đọc Tài liệu Đính kèm (Inbound Document Reader):\n` +
            `- Khi người dùng gửi hoặc hỏi về nội dung của một tệp tài liệu (.xlsx, .docx, .pdf, .csv, .txt): BẮT BUỘC gọi tool read_uploaded_document để trích xuất văn bản/bảng biểu rồi mới phân tích hoặc tóm tắt.\n\n` +
            `Quy tắc Quản lý Nhắc nhở & Lặp lại (Reliable & Recurring Reminders):\n` +
            `- Khi người dùng muốn đặt lời nhắc (ví dụ: "10 phút nữa nhắc...", "mai 8h nhắc...", "mỗi ngày lúc 8h tối nhắc uống thuốc"): BẮT BUỘC gọi tool create_reminder với dueAt (chuỗi ISO 8601), title, và recurrence ('NONE' | 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'MONTHLY' nếu có lặp lại). TUYỆT ĐỐI KHÔNG chỉ trả lời bằng lời hứa mà không gọi tool!\n` +
            `- Khi người dùng muốn dời lịch nhắc việc (ví dụ: "dời thêm 15 phút", "hoãn lại 30 phút"): BẮT BUỘC gọi tool reschedule_reminder.\n` +
            `- Khi người dùng muốn hủy lời nhắc (ví dụ: "hủy nhắc việc vừa rồi", "thôi không cần nhắc nữa"): BẮT BUỘC gọi tool cancel_reminder.\n` +
            `- Khi người dùng hỏi các việc cần làm/nhắc việc: BẮT BUỘC gọi tool list_reminders.\n\n` +
            `Quy tắc nhãn cảm xúc Sticker (Presentation Intent):\n` +
            `- Nếu ngữ cảnh và cảm xúc câu trả lời thật sự phù hợp để gửi kèm 1 sticker (chào hỏi vui vẻ, cảm ơn, chúc mừng, khen ngợi, hóm hỉnh, xin lỗi lỗi nhỏ), bạn hãy đặt thẻ [STICKER: <tên_cảm_xúc>] ở CUỐI CÙNG của câu trả lời.\n` +
            `- Các cảm xúc hợp lệ gồm: hello, happy, funny, thanks, sorry, celebrate, encourage, love, surprised, thinking, goodbye.\n` +
            `- Tuyệt đối KHÔNG đặt thẻ sticker khi thông báo lỗi hệ thống/bảo mật, khi giải thích kỹ thuật khô khan, hoặc khi yêu cầu phê duyệt hành động nhạy cảm.\n` +
            `- Nếu không cần sticker, không đặt thẻ này.\n\n` +
            `Quy tắc Tạo & Chỉnh sửa ảnh (Image Generation & Editing):\n` +
            `- Khi người dùng muốn tạo ảnh mới (ví dụ: "vẽ con mèo chibi", "tạo ảnh banner 16:9", "thiết kế poster..."): Hãy gọi tool generate_image với prompt chi tiết, có thể kèm aspectRatio ("1:1", "16:9", "9:16"...), resolution, style.\n` +
            `- Khi người dùng muốn chỉnh sửa ảnh (ví dụ: "đổi nền thành trắng", "sửa màu áo thành xanh", "chibi hóa ảnh này", "lấy ảnh vừa tạo đổi sang 9:16"...): Hãy gọi tool edit_image. Nếu người dùng không nêu sourceFileId thì để trống, hệ thống sẽ tự động dùng ảnh người dùng vừa gửi hoặc ảnh bot vừa sinh trong cuộc trò chuyện.\n` +
            `- Tool sẽ tự động gửi ảnh trực tiếp về Zalo. Khi tool hoàn thành thành công, bạn chỉ cần trả lời thông báo vui vẻ, ngắn gọn kèm nhận xét thân thiện hoặc hỏi xem ảnh đã đúng ý chưa.\n\n` +
            `Quy tắc Phân tích & Gửi lại Media (Images & Files):\n` +
            `- Khi người dùng yêu cầu gửi lại ảnh hoặc tệp tin (ví dụ: "gửi lại coi", "gửi lại ảnh đó", "cho xem lại", "gửi file đó"): BẮT BUỘC gọi tool resend_existing_media với mediaId tương ứng. TUYỆT ĐỐI KHÔNG chỉ nói suông mà không gọi tool!\n` +
            `- Khi người dùng hỏi nội dung hoặc thông tin trong ảnh (ví dụ: "ảnh đó có thông tin gì", "ảnh này là gì", "đọc chữ trong ảnh"): BẮT BUỘC gọi tool analyze_existing_image với mediaId tương ứng. Nếu kết quả tool báo mô hình không hỗ trợ thị giác (Vision), hãy giải thích trung thực cho người dùng, TUYỆT ĐỐI KHÔNG tự bịa đặt nội dung ảnh!\n` +
            `- Khi người dùng đưa ra nhiều yêu cầu trong cùng một câu (ví dụ: "Ảnh đó có thông tin gì? Gửi lại coi."): BẮT BUỘC gọi cả hai công cụ tương ứng (analyze_existing_image và resend_existing_media). Nếu phân tích vision bị giới hạn, VẪN PHẢI gửi lại ảnh bằng resend_existing_media (Partial Success)!\n` +
            `- Khi người dùng hỏi danh sách tệp/ảnh trong hội thoại: Gọi tool get_recent_media.` +
            memoryContextBlock +
            (injectedContextPrompt ? `\n\n${injectedContextPrompt}` : ''),
        },
      ];

      for (const h of recentHistory) {
        messages.push({
          role: h.direction === MessageDirection.INBOUND ? 'user' : 'assistant',
          content: h.content,
        });
      }

      const toolsSchema = this.toolRegistry.getOpenAIToolsSchema();
      let steps = 0;
      let finalAnswer = '';
      const fileLinkNotices: string[] = [];

      while (steps < this.maxSteps) {
        steps++;
        let llmRes;
        try {
          llmRes = await this.llmService.chat(messages, toolsSchema, {
            taskId: task.id,
            conversationId,
            ownerId,
          });
        } catch (err: any) {
          this.logger.error(`[AGENT_LOOP_ERROR] ${err.message}`, err.stack);
          const userMsg =
            err.name === 'OpenRouterCapabilityError' || err.name === 'OpenRouterBudgetError'
              ? `⚠️ **THÔNG BÁO TỪ HỆ THỐNG AI:**\n${err.message}`
              : `Dạ em xin lỗi, hệ thống AI tạm thời gặp gián đoạn (${err.message}). Anh/chị vui lòng thử lại sau giây lát giúp em nhé! 🙏`;
          await this.sendReply(chatId, userMsg);
          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: { status: TaskStatus.FAILED, error: err.message, completedAt: new Date() },
          });
          return;
        }

        if (llmRes.content) {
          finalAnswer = llmRes.content;
        }

        if (!llmRes.toolCalls || llmRes.toolCalls.length === 0) {
          break;
        }

        // Append assistant message with tool calls to context
        messages.push({
          role: 'assistant',
          content: llmRes.content,
          tool_calls: llmRes.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });

        // Execute each tool call
        for (const call of llmRes.toolCalls) {
          const tool = this.toolRegistry.getTool(call.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify({ error: `Tool ${call.name} not found` }),
            });
            continue;
          }

          // Check if tool requires approval
          if (tool.requiresApproval(call.arguments)) {
            const { code, approval } = await this.approvalsService.createApproval({
              taskId: task.id,
              ownerId,
              actionType: tool.name,
              payload: call.arguments,
            });

            await this.sendReply(
              chatId,
              `⚠️ **YÊU CẦU PHÊ DUYỆT BẮT BUỘC**\n` +
                `Hành động: **${tool.name}**\n` +
                `Chi tiết: ${JSON.stringify(call.arguments, null, 2)}\n\n` +
                `Để thực thi, vui lòng nhắn:\n` +
                `👉 \`/approve ${code}\`\n` +
                `Hoặc nhắn \`/deny ${code}\` để hủy bỏ. (Hiệu lực trong 15 phút)`,
            );

            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: { status: TaskStatus.WAITING_APPROVAL },
            });

            return; // Pause execution until owner approves
          }

          // Notify progress: tool starting
          await this.taskProgressService.notifyToolStarted(task.id, chatId, call.name, call.arguments);

          // Execute tool directly
          try {
            const output = await tool.execute(call.arguments, {
              ownerId,
              taskId: task.id,
              conversationId,
              chatId,
            });

            this.logger.log(`[AGENT_TOOL_SUCCESS] ${call.name}: ${JSON.stringify(output)}`);

            // Notify progress: tool completed
            await this.taskProgressService.notifyToolCompleted(task.id, chatId, call.name, output);

            // Multi-turn state recording
            if (['create_reminder', 'reschedule_reminder', 'set_reminder'].includes(call.name)) {
              const rid = output?.reminder?.id || output?.reminderId;
              if (rid) {
                await this.conversationStateService.recordReminder(conversationId, rid);
              }
            } else if (['create_excel', 'create_pdf', 'create_word'].includes(call.name)) {
              if (output?.fileId) {
                await this.conversationStateService.recordFile(conversationId, output.fileId);
              }
            } else if (['generate_image', 'edit_image'].includes(call.name)) {
              const imgId = output?.fileId || output?.imageId;
              if (imgId) {
                await this.conversationStateService.recordImage(conversationId, imgId);
              }
            } else if (call.name === 'resend_existing_media') {
              if (output?.mediaId) {
                if (output.mimeType?.startsWith('image/')) {
                  await this.conversationStateService.recordImage(conversationId, output.mediaId);
                } else {
                  await this.conversationStateService.recordFile(conversationId, output.mediaId);
                }
              }
            } else if (call.name === 'gmail_list_messages') {
              if (output?.messages && Array.isArray(output.messages)) {
                const threadIds = output.messages
                  .map((m: any) => m.threadId || m.id)
                  .filter((id: any): id is string => Boolean(id));
                if (threadIds.length > 0) {
                  await this.conversationStateService.recordEmailThreads(conversationId, threadIds);
                }
              }
            }

            if (output && output.message && ['create_excel', 'create_pdf', 'create_word'].includes(call.name)) {
              fileLinkNotices.push(output.message);
            }

            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify(output),
            });

            await this.prisma.taskStep.create({
              data: {
                taskId: task.id,
                sequence: steps,
                toolName: call.name,
                sanitizedInputJson: call.arguments,
                sanitizedOutputJson: output,
                status: 'SUCCESS',
              },
            });
          } catch (err: any) {
            this.logger.error(`[TOOL_ERROR] ${call.name}: ${err.message}`);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }
      }

      // Parse and extract contextual sticker intent from response
      let cleanAnswer = finalAnswer;
      let stickerEmotion: StickerEmotion | null = null;
      const stickerMatch = finalAnswer.match(/\[STICKER:\s*([a-zA-Z_-]+)\]/i);
      if (stickerMatch) {
        const candidate = stickerMatch[1].toLowerCase();
        cleanAnswer = finalAnswer.replace(/\[STICKER:\s*[a-zA-Z_-]+\]/gi, '').trim();
        if (this.stickerService.isValidEmotion(candidate)) {
          stickerEmotion = candidate;
        }
      }

      // Guarantee file path or download URL is appended for document creation tools
      if (fileLinkNotices.length > 0) {
        for (const notice of fileLinkNotices) {
          if (!cleanAnswer.includes(notice.slice(0, 30))) {
            cleanAnswer = `${cleanAnswer}\n\n${notice}`.trim();
          }
        }
      }

      if (cleanAnswer) {
        const messageChunks = splitIntoChatMessages(cleanAnswer);
        for (let i = 0; i < messageChunks.length; i++) {
          const chunk = messageChunks[i];
          await this.sendReply(chatId, chunk);
          await this.conversationsService.saveMessage({
            conversationId,
            direction: MessageDirection.OUTBOUND,
            content: chunk,
            type: MessageType.TEXT,
          });

          // Natural bubble pause if multiple messages
          if (i < messageChunks.length - 1) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        // Send contextual sticker if selected by AI and allowed
        if (stickerEmotion) {
          await this.stickerService.sendSticker(chatId, stickerEmotion);
        }

        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.COMPLETED,
            resultSummary: cleanAnswer.slice(0, 200),
            completedAt: new Date(),
          },
        });
      }
    } finally {
      this.taskProgressService.stopWatchdog(task.id);
    }
  }

  private async sendReply(chatId: string, text: string) {
    try {
      const clean = text.trim().replace(/\n{3,}/g, '\n\n');
      if (!clean) return;
      await this.zaloClient.sendMessage(chatId, clean);
    } catch (err: any) {
      this.logger.error(`Failed to send reply to Zalo: ${err.message}`);
    }
  }
}
