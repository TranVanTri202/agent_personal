import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { GmailService } from '../../gmail/gmail.service';

@Injectable()
export class CalendarListEventsTool implements AgentTool {
  name = 'calendar_list_events';
  description =
    'Xem danh sách sự kiện, lịch họp sắp tới hoặc kiểm tra lịch trống/bận trên Google Calendar của chủ sở hữu.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      timeMinIso: {
        type: 'string',
        description: 'Thời điểm bắt đầu tìm kiếm định dạng ISO 8601 (mặc định là thời점 hiện tại)',
      },
      timeMaxIso: {
        type: 'string',
        description: 'Thời điểm kết thúc tìm kiếm định dạng ISO 8601 (tùy chọn)',
      },
      maxResults: {
        type: 'number',
        description: 'Số lượng sự kiện tối đa (mặc định 10)',
      },
    },
  };

  constructor(private readonly gmailService: GmailService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: { timeMinIso?: string; timeMaxIso?: string; maxResults?: number },
    context: ToolExecutionContext,
  ): Promise<any> {
    try {
      const events = await this.gmailService.listCalendarEvents(
        context.ownerId,
        input.timeMinIso,
        input.timeMaxIso,
        input.maxResults || 10,
      );
      return {
        success: true,
        count: events.length,
        events,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
      };
    }
  }
}

@Injectable()
export class CalendarCreateEventTool implements AgentTool {
  name = 'calendar_create_event';
  description =
    'Tạo một sự kiện hoặc lịch họp mới trực tiếp lên Google Calendar của chủ sở hữu.';
  riskLevel: 'MEDIUM' = 'MEDIUM';
  inputSchema = {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Tiêu đề sự kiện hoặc cuộc họp (ví dụ: "Họp dự án với khách hàng A")',
      },
      startIso: {
        type: 'string',
        description: 'Thời gian bắt đầu định dạng ISO 8601 (ví dụ: 2026-11-04T09:00:00+07:00)',
      },
      endIso: {
        type: 'string',
        description: 'Thời gian kết thúc định dạng ISO 8601 (tùy chọn, mặc định kéo dài 60 phút)',
      },
      description: {
        type: 'string',
        description: 'Nội dung chi tiết hoặc ghi chú sự kiện (tùy chọn)',
      },
      location: {
        type: 'string',
        description: 'Địa điểm hoặc link phòng họp (tùy chọn)',
      },
    },
    required: ['summary', 'startIso'],
  };

  constructor(private readonly gmailService: GmailService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: { summary: string; startIso: string; endIso?: string; description?: string; location?: string },
    context: ToolExecutionContext,
  ): Promise<any> {
    try {
      const created = await this.gmailService.createCalendarEvent(context.ownerId, input);
      return {
        success: true,
        event: created,
        message: `📅 Đã thêm sự kiện **${created.summary}** lên Google Calendar!`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
      };
    }
  }
}
