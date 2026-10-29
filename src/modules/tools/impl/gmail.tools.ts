import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { GmailService } from '../../gmail/gmail.service';

@Injectable()
export class GmailListMessagesTool implements AgentTool {
  name = 'gmail_list_messages';
  description = 'Liệt kê danh sách các email gần đây từ hộp thư Gmail đã kết nối của chủ sở hữu.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      maxResults: { type: 'number', description: 'Số lượng email cần lấy (mặc định 10)' },
    },
  };

  constructor(private readonly gmailService: GmailService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { maxResults?: number }, context: ToolExecutionContext): Promise<any> {
    if (!this.gmailService.isConfigured()) {
      return {
        success: false,
        message: 'Tính năng Gmail chưa được bật hoặc chưa cấu hình GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.',
      };
    }

    try {
      const messages = await this.gmailService.listRecentEmails(context.ownerId, input.maxResults || 10);
      return {
        success: true,
        count: messages.length,
        messages,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}

@Injectable()
export class GmailCreateDraftTool implements AgentTool {
  name = 'gmail_create_draft';
  description = 'Tạo một bản nháp email (draft) trong hộp thư Gmail để chủ sở hữu xem trước.';
  riskLevel: 'MEDIUM' = 'MEDIUM';
  inputSchema = {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Địa chỉ email người nhận' },
      subject: { type: 'string', description: 'Tiêu đề email' },
      body: { type: 'string', description: 'Nội dung email' },
    },
    required: ['to', 'subject', 'body'],
  };

  constructor(private readonly gmailService: GmailService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: { to: string; subject: string; body: string }, context: ToolExecutionContext): Promise<any> {
    if (!this.gmailService.isConfigured()) {
      return {
        success: false,
        message: 'Tính năng Gmail chưa được bật hoặc chưa cấu hình GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.',
      };
    }

    try {
      const draft = await this.gmailService.createDraft(context.ownerId, input.to, input.subject, input.body);
      return {
        success: true,
        message: `Đã tạo bản nháp email tới ${input.to} thành công.`,
        draft,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}

@Injectable()
export class GmailSendEmailTool implements AgentTool {
  name = 'gmail_send_email';
  description = 'Gửi email thật qua Gmail. YÊU CẦU PHÊ DUYỆT BẮT BUỘC TỪ CHỦ SỞ HỮU TRƯỚC KHI GỬI.';
  riskLevel: 'HIGH' = 'HIGH';
  inputSchema = {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Địa chỉ email người nhận' },
      subject: { type: 'string', description: 'Tiêu đề email' },
      body: { type: 'string', description: 'Nội dung email' },
    },
    required: ['to', 'subject', 'body'],
  };

  constructor(private readonly gmailService: GmailService) {}

  requiresApproval(): boolean {
    return true; // HIGH risk - always requires approval
  }

  async execute(input: { to: string; subject: string; body: string }, context: ToolExecutionContext): Promise<any> {
    if (!this.gmailService.isConfigured()) {
      return {
        success: false,
        message: 'Tính năng Gmail chưa được bật hoặc chưa cấu hình GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.',
      };
    }

    try {
      const res = await this.gmailService.sendEmail(context.ownerId, input.to, input.subject, input.body);
      return {
        success: true,
        message: `Đã gửi email thành công tới ${input.to}! (ID: ${res.messageId})`,
        messageId: res.messageId,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
