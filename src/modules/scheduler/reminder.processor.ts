import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { REMINDER_QUEUE_NAME, ReminderJobData } from './scheduler.service';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Processor(REMINDER_QUEUE_NAME)
export class ReminderProcessor extends WorkerHost {
  constructor(
    private readonly zaloClient: ZaloApiClient,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<any> {
    const { reminderId, revision } = job.data;
    this.logger.log(`[REMINDER_WORKER] Processing job for Reminder #${reminderId} (rev: ${revision})`);

    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder) {
      this.logger.warn(`[REMINDER_WORKER] Reminder #${reminderId} not found in DB. Discarding job.`);
      return { skipped: true, reason: 'NOT_FOUND' };
    }

    // Guard: ignore if cancelled or revision mismatch (already rescheduled)
    if (reminder.status !== 'SCHEDULED') {
      this.logger.log(`[REMINDER_WORKER] Reminder #${reminderId} status is "${reminder.status}". Skipping.`);
      return { skipped: true, reason: reminder.status };
    }

    if (reminder.revision !== revision) {
      this.logger.log(
        `[REMINDER_WORKER] Revision mismatch for #${reminderId} (job rev: ${revision}, DB rev: ${reminder.revision}). Skipping obsolete job.`,
      );
      return { skipped: true, reason: 'OBSOLETE_REVISION' };
    }

    // Claim reminder
    await this.prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status: 'SENDING',
        claimedAt: new Date(),
      },
    });

    try {
      const now = Date.now();
      const lateMs = now - reminder.dueAt.getTime();
      const originalTime = reminder.dueAt.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      // Construct courteous notification message
      let message = '';
      if (lateMs > 120_000) {
        message =
          `⏰ **LỜI NHẮC (Gửi bù):**\n` +
          `Anh/chị ơi, đến giờ **${reminder.title}** rồi ạ!\n\n` +
          `*(Dạ em xin lỗi vì thông báo bị trễ lúc ${originalTime} do hệ thống tạm dừng).*`;
      } else {
        message = `⏰ Anh/chị ơi, đến giờ **${reminder.title}** rồi ạ! Chiến thôi anh/chị 😄`;
      }

      if (reminder.note) {
        message += `\n📝 Ghi chú: ${reminder.note}`;
      }

      this.logger.log(`[REMINDER_SENDING] Dispatching notification to Zalo chat ${reminder.recipientChatId}...`);
      await this.zaloClient.sendMessage(reminder.recipientChatId, message);

      // Mark SENT in DB
      await this.prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      this.logger.log(`[REMINDER_SENT] Successfully delivered reminder #${reminderId} to ${reminder.recipientChatId}`);
      return { success: true };
    } catch (err: any) {
      this.logger.error(`[REMINDER_DELIVERY_FAILED] Error sending reminder #${reminderId}: ${err.message}`);

      const nextAttempt = reminder.attemptCount + 1;
      const isFinalAttempt = nextAttempt >= 3;

      await this.prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'SCHEDULED', // reset to SCHEDULED if BullMQ will retry
          attemptCount: nextAttempt,
          lastError: err.message,
        },
      });

      throw err; // Allow BullMQ backoff retry
    }
  }
}
