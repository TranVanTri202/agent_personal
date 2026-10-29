import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { ReminderTimeParser } from '../../scheduler/reminder-time-parser';

@Injectable()
export class CreateReminderTool implements AgentTool {
  name = 'create_reminder';
  description =
    'Tạo lịch nhắc nhở việc cần làm theo thời gian chỉ định (theo múi giờ Asia/Ho_Chi_Minh). Hệ thống sẽ tự động gửi tin nhắn Zalo chủ động nhắc nhở khi đến giờ hẹn mà không cần người dùng hỏi lại.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nội dung hoặc hành động cần nhắc (ví dụ: làm việc, uống nước, gọi điện khách hàng)' },
      dueAt: { type: 'string', description: 'Thời gian nhắc nhở định dạng ISO 8601 (ví dụ: 2026-10-29T10:10:00+07:00)' },
      note: { type: 'string', description: 'Ghi chú bổ sung nếu có' },
    },
    required: ['title', 'dueAt'],
  };

  constructor(private readonly schedulerService: SchedulerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { title?: string; name?: string; dueAt?: string; runAtIso?: string; note?: string }, context: ToolExecutionContext): Promise<any> {
    const title = (input.title || input.name || 'công việc đã hẹn').trim();
    const rawTime = input.dueAt || input.runAtIso;

    let dueAt: Date;
    if (rawTime) {
      dueAt = new Date(rawTime);
      if (isNaN(dueAt.getTime())) {
        const parsed = ReminderTimeParser.parse(rawTime);
        if (parsed.success && parsed.dueAt) {
          dueAt = parsed.dueAt;
        } else {
          return { success: false, message: 'Thời gian không hợp lệ. Vui lòng cung cấp định dạng thời gian chuẩn.' };
        }
      }
    } else {
      // Default fallback: 10 minutes from now
      dueAt = new Date(Date.now() + 10 * 60 * 1000);
    }

    const res = await this.schedulerService.createReminder({
      ownerId: context.ownerId,
      chatId: context.chatId,
      title,
      dueAt,
      note: input.note,
      sourceConversationId: context.conversationId,
    });

    if (!res.success || !res.reminder) {
      return {
        success: false,
        message: res.error || 'Không thể lên lịch nhắc nhở do lỗi hệ thống.',
      };
    }

    return {
      success: true,
      id: res.reminder.id,
      reminderId: res.reminder.id,
      title: res.reminder.title,
      dueAt: res.reminder.dueAt.toISOString(),
      formattedTime: res.formattedTime,
      message: `Dạ vâng ạ! Em đã đặt lời nhắc **${res.reminder.title}** lúc **${res.formattedTime}** rồi nhé ⏰`,
    };
  }
}

@Injectable()
export class ListRemindersTool implements AgentTool {
  name = 'list_reminders';
  description = 'Xem danh sách các lời nhắc nhở sắp tới của người dùng trong cuộc trò chuyện này.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {},
  };

  constructor(private readonly schedulerService: SchedulerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(_input: any, context: ToolExecutionContext): Promise<any> {
    const list = await this.schedulerService.listActiveReminders(context.ownerId, context.chatId);
    if (list.length === 0) {
      return {
        success: true,
        count: 0,
        message: 'Hiện tại anh/chị không có lời nhắc nào sắp tới ạ.',
      };
    }

    const formattedList = list.map((r, i) => {
      const timeStr = r.dueAt.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      return `${i + 1}. **${r.title}** (Mã: \`${r.id.slice(0, 8)}\` - lúc ${timeStr})`;
    });

    return {
      success: true,
      count: list.length,
      reminders: list.map((r) => ({ id: r.id, title: r.title, dueAt: r.dueAt.toISOString() })),
      message: `📋 **DANH SÁCH LỜI NHẮC SẮP TỚI:**\n${formattedList.join('\n')}`,
    };
  }
}

@Injectable()
export class GetReminderTool implements AgentTool {
  name = 'get_reminder';
  description = 'Xem thông tin chi tiết của một lời nhắc việc theo mã ID.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      reminderId: { type: 'string', description: 'ID của lời nhắc cần xem' },
    },
    required: ['reminderId'],
  };

  constructor(private readonly schedulerService: SchedulerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { reminderId: string }, context: ToolExecutionContext): Promise<any> {
    const reminder = await this.schedulerService.getReminder(input.reminderId);
    if (!reminder || (reminder.ownerId && reminder.ownerId !== context.ownerId)) {
      return { success: false, message: `Không tìm thấy lời nhắc với mã "${input.reminderId}".` };
    }

    const timeStr = reminder.dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return {
      success: true,
      reminder: {
        id: reminder.id,
        title: reminder.title,
        status: reminder.status,
        dueAt: reminder.dueAt.toISOString(),
        formattedTime: timeStr,
        note: reminder.note,
      },
      message: `📌 Lời nhắc **${reminder.title}** (Trạng thái: ${reminder.status}) hẹn lúc: ${timeStr}.`,
    };
  }
}

@Injectable()
export class CancelReminderTool implements AgentTool {
  name = 'cancel_reminder';
  description = 'Hủy một lời nhắc việc đã lên lịch.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      reminderId: { type: 'string', description: 'ID của lời nhắc cần hủy (nếu không điền sẽ lấy lời nhắc gần nhất)' },
    },
  };

  constructor(private readonly schedulerService: SchedulerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { reminderId?: string }, context: ToolExecutionContext): Promise<any> {
    let reminderId = input.reminderId;

    if (!reminderId) {
      // Find latest active reminder in this chat
      const active = await this.schedulerService.listActiveReminders(context.ownerId, context.chatId);
      if (active.length === 0) {
        return { success: false, message: 'Hiện tại không có lời nhắc nào đang chờ để hủy ạ.' };
      }
      reminderId = active[0].id;
    }

    return await this.schedulerService.cancelReminder(reminderId, context.ownerId);
  }
}

@Injectable()
export class RescheduleReminderTool implements AgentTool {
  name = 'reschedule_reminder';
  description = 'Dời thời gian hoặc hoãn thêm một lời nhắc việc đã lên lịch (ví dụ: dời thêm 5 phút, hoãn 15 phút, hoặc đổi sang giờ mới).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      reminderId: { type: 'string', description: 'ID của lời nhắc (tùy chọn, để trống sẽ tự lấy lời nhắc gần nhất)' },
      extendMinutes: { type: 'number', description: 'Số phút dời thêm (ví dụ: 5, 10, 15)' },
      newDueAt: { type: 'string', description: 'Thời điểm mới dạng ISO 8601' },
    },
  };

  constructor(private readonly schedulerService: SchedulerService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { reminderId?: string; extendMinutes?: number; newDueAt?: string }, context: ToolExecutionContext): Promise<any> {
    let reminderId = input.reminderId;

    if (!reminderId) {
      const active = await this.schedulerService.listActiveReminders(context.ownerId, context.chatId);
      if (active.length === 0) {
        return { success: false, message: 'Hiện tại không có lời nhắc nào đang chờ để dời lịch ạ.' };
      }
      reminderId = active[0].id;
    }

    let targetDueAt: Date | undefined;
    if (input.newDueAt) {
      targetDueAt = new Date(input.newDueAt);
    }

    return await this.schedulerService.rescheduleReminder({
      reminderId,
      ownerId: context.ownerId,
      newDueAt: targetDueAt,
      extendMinutes: input.extendMinutes,
    });
  }
}
