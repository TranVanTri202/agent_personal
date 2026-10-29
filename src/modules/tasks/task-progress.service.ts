import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ZaloApiClient } from '../zalo/zalo-api.client';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export type TaskEventType =
  | 'accepted'
  | 'started'
  | 'tool_started'
  | 'tool_completed'
  | 'waiting_approval'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskProgressEvent {
  taskId: string;
  chatId: string;
  eventType: TaskEventType;
  step?: string;
  toolName?: string;
  description?: string;
}

@Injectable()
export class TaskProgressService implements OnModuleDestroy {
  // taskId -> active watchdog interval
  private watchdogs = new Map<string, NodeJS.Timeout>();
  // taskId -> last event timestamp
  private lastEventTimes = new Map<string, number>();

  constructor(
    private readonly zaloClient: ZaloApiClient,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleDestroy() {
    this.clearAllWatchdogs();
  }

  isLongRunningTask(text: string): boolean {
    const lower = text.toLowerCase();
    const longIndicators = [
      'tạo file',
      'excel',
      'xlsx',
      'pdf',
      'word',
      'docx',
      'bảng tính',
      'tài liệu',
      'gmail',
      'email',
      'hộp thư',
      'gửi thư',
      'soạn thư',
      'tóm tắt',
      'lập kế hoạch',
      'kế hoạch',
      'phân tích',
      'tìm kiếm',
      'viết code',
      'lập trình',
      'tạo ảnh',
      'vẽ ảnh',
      'vẽ',
      'chỉnh ảnh',
      'sửa ảnh',
      'chỉnh sửa ảnh',
      'chibi',
      'banner',
      'poster',
      'mascot',
      'image',
      'photo',
    ];
    return longIndicators.some((indicator) => lower.includes(indicator));
  }

  generateAckMessage(userPrompt: string): string {
    const lower = userPrompt.toLowerCase();
    if (
      lower.includes('ảnh') ||
      lower.includes('vẽ') ||
      lower.includes('chibi') ||
      lower.includes('banner') ||
      lower.includes('poster') ||
      lower.includes('mascot') ||
      lower.includes('image') ||
      lower.includes('photo')
    ) {
      return 'Dạ vâng ạ, em nhận yêu cầu tạo/chỉnh sửa ảnh rồi! Em bắt đầu xử lý nhé 🎨';
    }
    if (lower.includes('excel') || lower.includes('xlsx') || lower.includes('bảng tính')) {
      return 'Dạ, em nhận việc rồi ạ. Em bắt đầu chuẩn bị dữ liệu và tạo file Excel cho anh/chị ngay nhé.';
    }
    if (lower.includes('pdf') || lower.includes('word') || lower.includes('docx') || lower.includes('tài liệu')) {
      return 'Dạ vâng, em nhận việc rồi ạ. Em đang chuẩn bị văn bản và định dạng tài liệu cho anh/chị đây ạ.';
    }
    if (lower.includes('gmail') || lower.includes('email') || lower.includes('thư')) {
      return 'Dạ, em nhận việc rồi ạ. Em đang kết nối kiểm tra hộp thư Gmail cho anh/chị ngay nhé.';
    }
    if (lower.includes('kế hoạch') || lower.includes('chiến lược')) {
      return 'Dạ vâng, em đã nhận yêu cầu. Em đang phân tích và lên dàn ý kế hoạch chi tiết cho anh/chị đây ạ.';
    }
    if (lower.includes('code') || lower.includes('lập trình') || lower.includes('bug')) {
      return 'Dạ, em nhận việc rồi ạ. Em đang xem xét mã nguồn và chuẩn bị giải pháp nhé.';
    }
    return 'Dạ, em nhận việc rồi ạ. Em bắt đầu thực hiện ngay nhé.';
  }

  async sendEarlyAck(chatId: string, userPrompt: string): Promise<void> {
    const ackText = this.generateAckMessage(userPrompt);
    try {
      await this.zaloClient.sendMessage(chatId, ackText);
    } catch (err: any) {
      this.logger.warn(`[TASK_PROGRESS] Failed to send early ACK to chat ${chatId}: ${err.message}`);
    }
  }

  startWatchdog(taskId: string, chatId: string, delayMs = 18000) {
    this.stopWatchdog(taskId);
    this.lastEventTimes.set(taskId, Date.now());

    const timer = setInterval(async () => {
      const lastTime = this.lastEventTimes.get(taskId) || 0;
      const elapsed = Date.now() - lastTime;
      if (elapsed >= delayMs) {
        try {
          this.logger.log(`[TASK_PROGRESS] Sending reassuring watchdog status for task #${taskId}`);
          await this.zaloClient.sendMessage(chatId, 'Dạ em vẫn đang tích cực xử lý, anh/chị đợi em thêm một chút nhé ạ.');
          this.lastEventTimes.set(taskId, Date.now());
        } catch (err: any) {
          this.logger.warn(`[TASK_PROGRESS] Could not send watchdog message: ${err.message}`);
        }
      }
    }, delayMs);

    this.watchdogs.set(taskId, timer);
  }

  stopWatchdog(taskId: string) {
    const timer = this.watchdogs.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.watchdogs.delete(taskId);
    }
    this.lastEventTimes.delete(taskId);
  }

  clearAllWatchdogs() {
    for (const [taskId, timer] of this.watchdogs.entries()) {
      clearInterval(timer);
    }
    this.watchdogs.clear();
    this.lastEventTimes.clear();
  }

  async notifyToolStarted(taskId: string, chatId: string, toolName: string, args?: any): Promise<void> {
    this.lastEventTimes.set(taskId, Date.now());
    let msg = '';

    switch (toolName) {
      case 'create_excel':
        const filename = args?.filename || 'bảng tính';
        msg = `📊 Dạ, em đang xử lý dữ liệu và tạo bảng tính Excel ("${filename}")...`;
        break;
      case 'create_pdf':
        msg = '📄 Dạ, em đang thiết lập trang và tạo file PDF...';
        break;
      case 'create_word':
        msg = '📝 Dạ, em đang định dạng nội dung và tạo tài liệu Word...';
        break;
      case 'gmail_list_messages':
      case 'gmail_get_message':
        msg = '📧 Dạ, em đang kết nối Gmail và đọc các thư gần nhất...';
        break;
      case 'gmail_create_draft':
        msg = '✉️ Dạ, em đang soạn thảo nội dung bản nháp email...';
        break;
      case 'gmail_send_email':
        msg = '🚀 Dạ, em đang chuẩn bị các thông tin để gửi email...';
        break;
      case 'set_reminder':
      case 'create_reminder':
        msg = '⏰ Dạ, em đang lên lịch nhắc việc vào hệ thống...';
        break;
      case 'reschedule_reminder':
        msg = '⏰ Dạ, em đang điều chỉnh thời gian nhắc việc...';
        break;
      case 'cancel_reminder':
        msg = '🛑 Dạ, em đang tiến hành hủy lịch nhắc việc...';
        break;
      case 'list_reminders':
        msg = '📋 Dạ, em đang kiểm tra các lịch nhắc việc đang chờ...';
        break;
      case 'generate_image':
        msg = '🎨 Dạ vâng ạ, em bắt đầu vẽ đây! Để xem ý tưởng này lên hình xinh cỡ nào...';
        break;
      case 'edit_image':
        msg = '🎨 Dạ, em đang lấy ảnh tham chiếu và tiến hành chỉnh sửa theo yêu cầu của anh/chị...';
        break;
      default:
        msg = `⚙️ Dạ, em đang thực hiện bước "${toolName}"...`;
        break;
    }

    try {
      await this.zaloClient.sendMessage(chatId, msg);
    } catch (err: any) {
      this.logger.warn(`[TASK_PROGRESS] Failed sending tool_started notice: ${err.message}`);
    }
  }

  async notifyToolCompleted(taskId: string, chatId: string, toolName: string, output?: any): Promise<void> {
    this.lastEventTimes.set(taskId, Date.now());
    // Only send intermediate completion if it provides meaningful confidence to user
    if (toolName === 'create_excel' || toolName === 'create_pdf' || toolName === 'create_word') {
      const filename = output?.filename || 'tệp';
      try {
        await this.zaloClient.sendMessage(chatId, `✅ Dạ, em đã tạo xong nội dung file "${filename}", đang hoàn tất câu trả lời ạ.`);
      } catch (err: any) {
        this.logger.warn(`[TASK_PROGRESS] Failed sending tool_completed notice: ${err.message}`);
      }
    } else if (toolName === 'generate_image' || toolName === 'edit_image') {
      if (output?.success) {
        try {
          await this.zaloClient.sendMessage(chatId, '🖼️ Em đã hoàn thành ảnh rồi ạ! Đang gửi ảnh về Zalo cho anh/chị nhé.');
        } catch (err: any) {
          this.logger.warn(`[TASK_PROGRESS] Failed sending tool_completed notice: ${err.message}`);
        }
      }
    }
  }
}
