import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { ReminderTimeParser, RecurrenceRule } from './reminder-time-parser';
import { Reminder } from '@prisma/client';

export const REMINDER_QUEUE_NAME = 'reminders-queue';

export interface ReminderJobData {
  reminderId: string;
  revision: number;
}

export interface ReminderHealthStatus {
  redisStatus: string;
  delayedJobCount: number;
  scheduledDbCount: number;
  failedDbCount: number;
  isHealthy: boolean;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private proactiveDigestTimer: NodeJS.Timeout | null = null;
  private lastMorningDigestDate = '';
  private lastEveningDigestDate = '';

  constructor(
    @InjectQueue(REMINDER_QUEUE_NAME) private readonly reminderQueue: Queue<ReminderJobData>,
    private readonly prisma: PrismaService,
    private readonly zaloClient: ZaloApiClient,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit() {
    if (process.env.IS_WORKER_PROCESS === 'true') {
      this.logger.log('[SCHEDULER] Worker process initialized; periodic reconciliation runs on main server.');
      return;
    }

    this.logger.log('[SCHEDULER] Initializing Scheduler Service and running reconciliation...');
    // Reconcile pending reminders upon startup
    await this.reconcileReminders().catch((err) => {
      this.logger.error(`[SCHEDULER_RECONCILE_ERROR] Startup reconciliation failed: ${err.message}`);
    });

    // Run reconciliation every 3 minutes to guarantee reliability
    this.reconciliationTimer = setInterval(() => {
      this.reconcileReminders().catch((err) => {
        this.logger.warn(`[SCHEDULER_PERIODIC_RECONCILE_ERROR] ${err.message}`);
      });
    }, 3 * 60 * 1000);

    // Proactive Daily Digest (Morning 07:30 & Evening 21:30 Asia/Ho_Chi_Minh)
    if (process.env.NODE_ENV !== 'test') {
      this.proactiveDigestTimer = setInterval(() => {
        this.checkProactiveDailyDigest().catch((err) => {
          this.logger.warn(`[SCHEDULER_DIGEST_ERROR] ${err.message}`);
        });
      }, 60 * 1000);
    }
  }

  onModuleDestroy() {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    if (this.proactiveDigestTimer) {
      clearInterval(this.proactiveDigestTimer);
      this.proactiveDigestTimer = null;
    }
  }

  /**
   * Creates a reliable Reminder: commits to PostgreSQL and enqueues delayed job in BullMQ.
   */
  async createReminder(params: {
    ownerId: string;
    chatId: string;
    title: string;
    dueAt: Date;
    note?: string;
    recurrence?: RecurrenceRule;
    createdFromMessageId?: string;
    sourceConversationId?: string;
  }): Promise<{ success: boolean; reminder?: Reminder; formattedTime?: string; recurrence?: RecurrenceRule; error?: string }> {
    const now = new Date();
    // Validate dueAt is at least 3 seconds in the future
    if (params.dueAt.getTime() <= now.getTime() + 3000) {
      return {
        success: false,
        error: 'Thời gian nhắc nhở phải ở tương lai (tối thiểu sau 5 giây).',
      };
    }

    // Deduplication check if message ID provided
    if (params.createdFromMessageId) {
      const existing = await this.prisma.reminder.findFirst({
        where: { createdFromMessageId: params.createdFromMessageId },
      });
      if (existing) {
        this.logger.warn(`[REMINDER] Duplicate message ${params.createdFromMessageId} detected. Returning existing reminder.`);
        const { recurrence: existingRec } = ReminderTimeParser.extractRecurrenceFromNote(existing.note);
        return {
          success: true,
          reminder: existing,
          recurrence: existingRec,
          formattedTime: existing.dueAt.toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh',
          }),
        };
      }
    }

    const effectiveRecurrence = params.recurrence || ReminderTimeParser.detectRecurrence(params.title);
    const encodedNote = ReminderTimeParser.encodeNoteWithRecurrence(params.note, effectiveRecurrence);

    // 1. Save to PostgreSQL
    const reminder = await this.prisma.reminder.create({
      data: {
        ownerId: params.ownerId,
        recipientChatId: params.chatId,
        title: params.title.trim(),
        note: encodedNote,
        dueAt: params.dueAt,
        status: 'SCHEDULED',
        revision: 1,
        createdFromMessageId: params.createdFromMessageId,
        sourceConversationId: params.sourceConversationId,
      },
    });

    // 2. Enqueue delayed BullMQ job
    const delay = Math.max(0, reminder.dueAt.getTime() - Date.now());
    const jobId = `reminder-${reminder.id}-${reminder.revision}`;

    try {
      await this.reminderQueue.add(
        'deliver-reminder',
        {
          reminderId: reminder.id,
          revision: reminder.revision,
        },
        {
          jobId,
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
        },
      );

      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: { queuedAt: new Date() },
      });

      this.logger.log(`[REMINDER_CREATED] Reminder #${reminder.id} ("${reminder.title}") queued with delay ${delay}ms`);

      const formattedTime = reminder.dueAt.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      return {
        success: true,
        reminder,
        recurrence: effectiveRecurrence,
        formattedTime,
      };
    } catch (enqueueErr: any) {
      this.logger.error(`[REMINDER_ENQUEUE_FAILED] Failed to enqueue BullMQ job for #${reminder.id}: ${enqueueErr.message}`);
      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'PENDING_ENQUEUE', lastError: enqueueErr.message },
      });

      return {
        success: false,
        error: `Đã lưu lời nhắc vào cơ sở dữ liệu nhưng hệ thống lập lịch Redis đang bận. Em sẽ tự động khôi phục trong ít phút.`,
      };
    }
  }

  /**
   * Reschedules an active reminder to a new time or extends by X minutes.
   */
  async rescheduleReminder(params: {
    reminderId: string;
    ownerId: string;
    newDueAt?: Date;
    extendMinutes?: number;
  }): Promise<{ success: boolean; reminder?: Reminder; formattedTime?: string; message: string }> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: params.reminderId },
    });

    if (!reminder) {
      return { success: false, message: `Không tìm thấy lời nhắc với mã "${params.reminderId}".` };
    }

    if (reminder.status === 'SENT') {
      return { success: false, message: 'Lời nhắc này đã được gửi rồi ạ.' };
    }
    if (reminder.status === 'CANCELLED') {
      return { success: false, message: 'Lời nhắc này đã bị hủy trước đó rồi ạ.' };
    }

    let targetDueAt: Date;
    if (params.newDueAt) {
      targetDueAt = params.newDueAt;
    } else if (params.extendMinutes) {
      targetDueAt = new Date(reminder.dueAt.getTime() + params.extendMinutes * 60 * 1000);
    } else {
      targetDueAt = new Date(Date.now() + 15 * 60 * 1000); // default +15 min
    }

    const nextRevision = reminder.revision + 1;

    // 1. Remove old delayed job from BullMQ
    const oldJobId = `reminder-${reminder.id}-${reminder.revision}`;
    try {
      const oldJob = await this.reminderQueue.getJob(oldJobId);
      if (oldJob) await oldJob.remove();
    } catch (err: any) {
      this.logger.warn(`[REMINDER_RESCHEDULE] Could not remove old job ${oldJobId}: ${err.message}`);
    }

    // 2. Update DB with new revision and dueAt
    const updated = await this.prisma.reminder.update({
      where: { id: reminder.id },
      data: {
        dueAt: targetDueAt,
        revision: nextRevision,
        status: 'SCHEDULED',
        updatedAt: new Date(),
      },
    });

    // 3. Enqueue new delayed job
    const delay = Math.max(0, targetDueAt.getTime() - Date.now());
    const newJobId = `reminder-${updated.id}-${nextRevision}`;

    await this.reminderQueue.add(
      'deliver-reminder',
      {
        reminderId: updated.id,
        revision: nextRevision,
      },
      {
        jobId: newJobId,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );

    const formattedTime = targetDueAt.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    this.logger.log(`[REMINDER_RESCHEDULED] Reminder #${updated.id} rescheduled to ${formattedTime} (delay: ${delay}ms)`);

    return {
      success: true,
      reminder: updated,
      formattedTime,
      message: `Dạ vâng, em đã dời lời nhắc "${updated.title}" sang **${formattedTime}** rồi nhé ⏰`,
    };
  }

  /**
   * Cancels an active reminder.
   */
  async cancelReminder(reminderId: string, ownerId: string): Promise<{ success: boolean; message: string }> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder) {
      return { success: false, message: `Không tìm thấy lời nhắc với mã "${reminderId}".` };
    }

    if (reminder.status === 'CANCELLED') {
      return { success: true, message: 'Lời nhắc này đã được hủy trước đó rồi ạ.' };
    }
    if (reminder.status === 'SENT') {
      return { success: false, message: 'Lời nhắc này đã được gửi trước đó, không thể hủy nữa ạ.' };
    }

    // 1. Update DB state
    await this.prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    // 2. Best-effort remove from BullMQ
    const jobId = `reminder-${reminder.id}-${reminder.revision}`;
    try {
      const job = await this.reminderQueue.getJob(jobId);
      if (job) await job.remove();
    } catch {
      // Ignored
    }

    this.logger.log(`[REMINDER_CANCELLED] Reminder #${reminderId} has been cancelled.`);
    return {
      success: true,
      message: `Dạ em đã hủy lời nhắc "${reminder.title}" rồi ạ 👍`,
    };
  }

  /**
   * Lists upcoming active reminders for an owner/chat.
   */
  async listActiveReminders(ownerId?: string, chatId?: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        status: 'SCHEDULED',
        dueAt: { gte: new Date() },
        ...(ownerId ? { ownerId } : {}),
        ...(chatId ? { recipientChatId: chatId } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
    });
  }

  /**
   * Gets detail of a specific reminder.
   */
  async getReminder(reminderId: string): Promise<Reminder | null> {
    return this.prisma.reminder.findUnique({
      where: { id: reminderId },
    });
  }

  /**
   * Self-healing reconciliation:
   * - Sends past-due reminders with courteous late apology notice (if server was turned off during scheduled time).
   * - Re-enqueues missing jobs into BullMQ if Redis was restarted.
   * - Un-sticks hanging SENDING leases (> 5 min).
   */
  async reconcileReminders(): Promise<{ deliveredLate: number; reEnqueued: number }> {
    const now = new Date();
    let deliveredLate = 0;
    let reEnqueued = 0;

    // 1. Fetch all pending/scheduled reminders
    const pendingReminders = await this.prisma.reminder.findMany({
      where: {
        status: { in: ['SCHEDULED', 'PENDING_ENQUEUE', 'SENDING'] },
      },
    });

    for (const r of pendingReminders) {
      // A. Past due by more than 1 minute (server was offline)
      if (r.dueAt.getTime() <= now.getTime() - 60 * 1000) {
        if (!r.isLateNoticeSent && r.status !== 'SENT' && r.status !== 'CANCELLED') {
          const originalTime = r.dueAt.toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh',
          });
          const lateMsg =
            `⏰ **LỜI NHẮC (Gửi bù):**\n` +
            `Anh/chị ơi, đến giờ **${r.title}** rồi ạ!\n\n` +
            `*(Dạ em xin lỗi vì thông báo bị trễ lúc ${originalTime} do hệ thống máy chủ vừa khởi động lại ạ).*`;

          try {
            await this.zaloClient.sendMessage(r.recipientChatId, lateMsg);
            const { recurrence } = ReminderTimeParser.extractRecurrenceFromNote(r.note);
            const nextDueAt = ReminderTimeParser.computeNextDueAt(r.dueAt, recurrence);

            if (nextDueAt) {
              const nextRev = r.revision + 1;
              await this.prisma.reminder.update({
                where: { id: r.id },
                data: {
                  status: 'SCHEDULED',
                  dueAt: nextDueAt,
                  revision: nextRev,
                  sentAt: new Date(),
                  isLateNoticeSent: false,
                },
              });
              const nextDelay = Math.max(0, nextDueAt.getTime() - Date.now());
              await this.reminderQueue.add(
                'deliver-reminder',
                { reminderId: r.id, revision: nextRev },
                {
                  jobId: `reminder-${r.id}-${nextRev}`,
                  delay: nextDelay,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 3000 },
                  removeOnComplete: true,
                },
              );
            } else {
              await this.prisma.reminder.update({
                where: { id: r.id },
                data: {
                  status: 'SENT',
                  sentAt: new Date(),
                  isLateNoticeSent: true,
                },
              });
            }
            deliveredLate++;
            this.logger.log(`[REMINDER_RECONCILE] Delivered late reminder #${r.id} to ${r.recipientChatId}`);
          } catch (err: any) {
            this.logger.error(`[REMINDER_RECONCILE_ERROR] Failed delivering late reminder #${r.id}: ${err.message}`);
          }
        }
        continue;
      }

      // B. Future reminder: ensure job exists in BullMQ queue
      if (r.dueAt.getTime() > now.getTime()) {
        const jobId = `reminder-${r.id}-${r.revision}`;
        try {
          const existingJob = await this.reminderQueue.getJob(jobId);
          if (!existingJob) {
            const delay = Math.max(0, r.dueAt.getTime() - Date.now());
            await this.reminderQueue.add(
              'deliver-reminder',
              { reminderId: r.id, revision: r.revision },
              {
                jobId,
                delay,
                attempts: 3,
                backoff: { type: 'exponential', delay: 3000 },
                removeOnComplete: true,
              },
            );
            reEnqueued++;
            this.logger.log(`[REMINDER_RECONCILE] Restored missing BullMQ job for #${r.id} (delay: ${delay}ms)`);
          }
        } catch (err: any) {
          this.logger.warn(`[REMINDER_RECONCILE_CHECK_ERROR] Check job ${jobId}: ${err.message}`);
        }
      }
    }

    return { deliveredLate, reEnqueued };
  }

  /**
   * Comprehensive healthcheck for reminders subsystem.
   */
  async getHealth(): Promise<ReminderHealthStatus> {
    let redisStatus = 'UNKNOWN';
    let delayedJobCount = 0;

    try {
      // Check BullMQ / Redis connection
      const counts = await this.reminderQueue.getJobCounts('delayed', 'waiting', 'active');
      delayedJobCount = counts.delayed || 0;
      redisStatus = 'CONNECTED (OK)';
    } catch (err: any) {
      redisStatus = `ERROR: ${err.message}`;
    }

    const scheduledDbCount = await this.prisma.reminder.count({
      where: { status: 'SCHEDULED' },
    });

    const failedDbCount = await this.prisma.reminder.count({
      where: { status: 'FAILED' },
    });

    return {
      redisStatus,
      delayedJobCount,
      scheduledDbCount,
      failedDbCount,
      isHealthy: redisStatus.includes('OK'),
    };
  }

  // --- Backward compatibility methods for existing ScheduledTask if needed ---
  async deleteReminder(id: string, ownerId: string): Promise<boolean> {
    const res = await this.cancelReminder(id, ownerId);
    return res.success;
  }

  /**
   * Generates a Daily Morning Briefing summarizing today's reminders and key memories.
   */
  async buildMorningBriefing(ownerId: string, chatId?: string): Promise<string> {
    const now = new Date();
    const dateStr = now.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const endOfDay = new Date(now.getTime() + 24 * 3600 * 1000);
    const reminders = await this.prisma.reminder.findMany({
      where: {
        ownerId,
        status: 'SCHEDULED',
        dueAt: { gte: now, lte: endOfDay },
        ...(chatId ? { recipientChatId: chatId } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
    });

    const memories = await this.prisma.memory.findMany({
      where: {
        ownerId,
        category: { notIn: ['finance_tx', 'bookmark_item'] },
      },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: 5,
    });

    let briefing = `☀️ **BẢN TIN SÁNG (${dateStr})**\nChúc anh/chị một ngày mới tràn đầy năng lượng và hiệu quả!\n\n`;

    if (reminders.length === 0) {
      briefing += `⏰ **Lịch nhắc việc trong 24h tới:**\n• Chưa có lời nhắc nào được lên lịch.\n`;
    } else {
      const rLines = reminders.map((r, idx) => {
        const t = r.dueAt.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        });
        const { recurrence } = ReminderTimeParser.extractRecurrenceFromNote(r.note);
        const recLabel = recurrence !== 'NONE' ? ` 🔄(${recurrence})` : '';
        return `${idx + 1}. **${t}** - ${r.title}${recLabel}`;
      });
      briefing += `⏰ **Lịch nhắc việc trong 24h tới (${reminders.length}):**\n${rLines.join('\n')}\n`;
    }

    if (memories.length > 0) {
      const mLines = memories.map((m) => `• [${m.category}] ${m.text}`);
      briefing += `\n🧠 **Ghi nhớ quan trọng của anh/chị:**\n${mLines.join('\n')}\n`;
    }

    briefing += `\n💡 Anh/chị cần em lên lịch nhắc việc mới, kiểm tra email hay tra cứu thông tin gì hôm nay cứ nhắn em nhé!`;
    return briefing;
  }

  /**
   * Generates an Evening Wrap-up summarizing today's expenses, completed reminders, and tomorrow's schedule.
   */
  async buildEveningWrapup(ownerId: string, chatId?: string): Promise<string> {
    const now = new Date();
    const dateStr = now.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Today's expenses
    const todayTx = await this.prisma.memory.findMany({
      where: {
        ownerId,
        category: 'finance_tx',
        createdAt: { gte: startOfToday },
      },
    });

    let todayExpense = 0;
    let todayIncome = 0;
    let txCount = 0;
    for (const r of todayTx) {
      try {
        const parsed = JSON.parse(r.text);
        txCount++;
        if (parsed.type === 'INCOME') todayIncome += Number(parsed.amount || 0);
        else todayExpense += Number(parsed.amount || 0);
      } catch {
        // ignore
      }
    }

    // 2. Tomorrow's scheduled reminders
    const endOfTomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const upcomingReminders = await this.prisma.reminder.findMany({
      where: {
        ownerId,
        status: 'SCHEDULED',
        dueAt: { gte: now, lte: endOfTomorrow },
        ...(chatId ? { recipientChatId: chatId } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
    });

    let msg = `🌙 **TỔNG KẾT CUỐI NGÀY (${dateStr})**\nHôm nay anh/chị đã vất vả rồi! Cùng em điểm lại một chút nhé:\n\n`;

    msg += `💰 **Chi tiêu hôm nay (${txCount} giao dịch):**\n`;
    msg += `• Tổng chi: **${Math.round(todayExpense).toLocaleString('vi-VN')} ₫**\n`;
    if (todayIncome > 0) {
      msg += `• Tổng thu: **+${Math.round(todayIncome).toLocaleString('vi-VN')} ₫**\n`;
    }

    if (upcomingReminders.length === 0) {
      msg += `\n⏰ **Lịch trình sáng/ngày mai:**\n• Chưa có lời nhắc nào sắp tới.\n`;
    } else {
      const rLines = upcomingReminders.map((r, i) => {
        const t = r.dueAt.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        });
        return `${i + 1}. **${t}** - ${r.title}`;
      });
      msg += `\n⏰ **Lịch nhắc việc sắp tới (${upcomingReminders.length}):**\n${rLines.join('\n')}\n`;
    }

    msg += `\nChúc anh/chị buổi tối thư giãn và ngủ ngon nhé! 💤`;
    return msg;
  }

  /**
   * Checks if it is 07:30 (Morning Briefing) or 21:30 (Evening Wrap-up) in Asia/Ho_Chi_Minh
   * and proactively sends the digest to the paired owner.
   */
  async checkProactiveDailyDigest(): Promise<void> {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const dateKey = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const hour = parseInt(getPart('hour'), 10);
    const minute = parseInt(getPart('minute'), 10);

    const isMorningSlot = hour === 7 && minute === 30 && this.lastMorningDigestDate !== dateKey;
    const isEveningSlot = hour === 21 && minute === 30 && this.lastEveningDigestDate !== dateKey;

    if (!isMorningSlot && !isEveningSlot) return;

    const owner = await this.prisma.user.findFirst({
      where: { role: 'OWNER' },
    });
    if (!owner) return;

    const privConv = await this.prisma.conversation.findFirst({
      where: { ownerId: owner.id, type: 'PRIVATE' },
      orderBy: { updatedAt: 'desc' },
    });
    const targetChatId = privConv?.externalChatId || owner.zaloUserId;
    if (!targetChatId) return;

    if (isMorningSlot) {
      this.lastMorningDigestDate = dateKey;
      const briefing = await this.buildMorningBriefing(owner.id, targetChatId);
      await this.zaloClient.sendMessage(targetChatId, briefing);
      this.logger.log(`[PROACTIVE_DIGEST] Sent 07:30 Morning Briefing to ${targetChatId}`);
    } else if (isEveningSlot) {
      this.lastEveningDigestDate = dateKey;
      const wrapup = await this.buildEveningWrapup(owner.id, targetChatId);
      await this.zaloClient.sendMessage(targetChatId, wrapup);
      this.logger.log(`[PROACTIVE_DIGEST] Sent 21:30 Evening Wrap-up to ${targetChatId}`);
    }
  }
}
