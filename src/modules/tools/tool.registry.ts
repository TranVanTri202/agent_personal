import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentTool } from './tool.interface';
import { CreateExcelTool, CreatePdfTool, CreateWordTool, ReadDocumentTool } from './impl/document.tools';
import { MemorySaveTool, MemorySearchTool, MemoryDeleteTool } from './impl/memory.tools';
import { WebSearchTool, FetchUrlTool } from './impl/web.tools';
import { ExpenseRecordTool, ExpenseSummaryTool } from './impl/expense.tools';
import { BookmarkSaveTool, BookmarkSearchTool } from './impl/bookmark.tools';
import { CalendarListEventsTool, CalendarCreateEventTool } from './impl/calendar.tools';
import { VietQrTool, SystemStatusTool } from './impl/utility.tools';
import {
  CreateReminderTool,
  ListRemindersTool,
  GetReminderTool,
  CancelReminderTool,
  RescheduleReminderTool,
} from './impl/reminder.tools';
import { GmailListMessagesTool, GmailCreateDraftTool, GmailSendEmailTool } from './impl/gmail.tools';
import { GenerateImageTool, EditImageTool } from './impl/image.tools';
import { ResendExistingMediaTool } from './impl/media-resend.tool';
import { AnalyzeExistingImageTool } from './impl/image-analysis.tool';
import { GetRecentMediaTool, GetMediaMetadataTool } from './impl/media-query.tools';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly tools = new Map<string, AgentTool>();

  constructor(
    private readonly logger: AppLoggerService,
    private readonly createExcelTool: CreateExcelTool,
    private readonly createPdfTool: CreatePdfTool,
    private readonly createWordTool: CreateWordTool,
    private readonly readDocumentTool: ReadDocumentTool,
    private readonly memorySaveTool: MemorySaveTool,
    private readonly memorySearchTool: MemorySearchTool,
    private readonly memoryDeleteTool: MemoryDeleteTool,
    private readonly webSearchTool: WebSearchTool,
    private readonly fetchUrlTool: FetchUrlTool,
    private readonly expenseRecordTool: ExpenseRecordTool,
    private readonly expenseSummaryTool: ExpenseSummaryTool,
    private readonly bookmarkSaveTool: BookmarkSaveTool,
    private readonly bookmarkSearchTool: BookmarkSearchTool,
    private readonly calendarListEventsTool: CalendarListEventsTool,
    private readonly calendarCreateEventTool: CalendarCreateEventTool,
    private readonly vietQrTool: VietQrTool,
    private readonly systemStatusTool: SystemStatusTool,
    private readonly createReminderTool: CreateReminderTool,
    private readonly listRemindersTool: ListRemindersTool,
    private readonly getReminderTool: GetReminderTool,
    private readonly cancelReminderTool: CancelReminderTool,
    private readonly rescheduleReminderTool: RescheduleReminderTool,
    private readonly gmailListMessagesTool: GmailListMessagesTool,
    private readonly gmailCreateDraftTool: GmailCreateDraftTool,
    private readonly gmailSendEmailTool: GmailSendEmailTool,
    private readonly generateImageTool: GenerateImageTool,
    private readonly editImageTool: EditImageTool,
    private readonly resendExistingMediaTool: ResendExistingMediaTool,
    private readonly analyzeExistingImageTool: AnalyzeExistingImageTool,
    private readonly getRecentMediaTool: GetRecentMediaTool,
    private readonly getMediaMetadataTool: GetMediaMetadataTool,
  ) {}

  onModuleInit() {
    this.register(this.createExcelTool);
    this.register(this.createPdfTool);
    this.register(this.createWordTool);
    this.register(this.readDocumentTool);
    this.register(this.memorySaveTool);
    this.register(this.memorySearchTool);
    this.register(this.memoryDeleteTool);
    this.register(this.webSearchTool);
    this.register(this.fetchUrlTool);
    this.register(this.expenseRecordTool);
    this.register(this.expenseSummaryTool);
    this.register(this.bookmarkSaveTool);
    this.register(this.bookmarkSearchTool);
    this.register(this.calendarListEventsTool);
    this.register(this.calendarCreateEventTool);
    this.register(this.vietQrTool);
    this.register(this.systemStatusTool);
    this.register(this.createReminderTool);
    this.register(this.listRemindersTool);
    this.register(this.getReminderTool);
    this.register(this.cancelReminderTool);
    this.register(this.rescheduleReminderTool);
    this.register(this.gmailListMessagesTool);
    this.register(this.gmailCreateDraftTool);
    this.register(this.gmailSendEmailTool);
    this.register(this.generateImageTool);
    this.register(this.editImageTool);
    this.register(this.resendExistingMediaTool);
    this.register(this.analyzeExistingImageTool);
    this.register(this.getRecentMediaTool);
    this.register(this.getMediaMetadataTool);
    this.logger.log(`[TOOL_REGISTRY] Registered ${this.tools.size} tools successfully.`);
  }

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  listTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getOpenAIToolsSchema(queryContext?: string): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    const selectedTools = queryContext ? this.filterToolsByContext(queryContext) : this.listTools();
    return selectedTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Dynamically prunes the 27 registered tools down to only the relevant subset
   * based on user intent and conversation context, saving 70%-85% of tool schema tokens.
   */
  filterToolsByContext(queryContext: string): AgentTool[] {
    const lower = queryContext.toLowerCase();
    const selectedNames = new Set<string>(['memory_save', 'web_search']);

    // 1. Memory search & delete
    if (/nhớ|bộ nhớ|memory|quên|sở thích|thói quen|thông tin của|tôi là ai|anh là ai/.test(lower)) {
      selectedNames.add('memory_search');
      selectedNames.add('memory_delete');
    }

    // 2. Reminders
    if (
      /nhắc|hẹn|lịch|báo thức|phút|tiếng|giờ|sáng mai|chiều mai|tối mai|ngày mai|lúc |dời|hoãn|hủy|hàng ngày|mỗi ngày|hàng tuần|reminder/.test(
        lower,
      )
    ) {
      selectedNames.add('create_reminder');
      selectedNames.add('list_reminders');
      selectedNames.add('get_reminder');
      selectedNames.add('cancel_reminder');
      selectedNames.add('reschedule_reminder');
    }

    // 3. Documents (Excel, PDF, Word, Uploaded Document Reader)
    if (/excel|xlsx|pdf|word|docx|file|tệp|tài liệu|báo cáo|bảng tính|văn bản|hợp đồng|csv|fileid/.test(lower)) {
      selectedNames.add('create_excel');
      selectedNames.add('create_pdf');
      selectedNames.add('create_word');
      selectedNames.add('read_uploaded_document');
    }

    // 4. Images & Media (Generate, Edit, Analyze, Resend)
    if (
      /ảnh|hình|photo|image|media|vẽ|thiết kế|poster|banner|logo|chibi|nền|màu|gửi lại|xem lại|coi|thông tin gì|cái thứ|mediaid|fileid/.test(
        lower,
      )
    ) {
      selectedNames.add('generate_image');
      selectedNames.add('edit_image');
      selectedNames.add('analyze_existing_image');
      selectedNames.add('resend_existing_media');
      selectedNames.add('get_recent_media');
      selectedNames.add('get_media_metadata');
    }

    // 5. Gmail & Google Calendar
    if (/mail|gmail|email|thư|hộp thư|nháp|calendar|lịch họp|cuộc họp|sự kiện|meet|rảnh|bận/.test(lower)) {
      selectedNames.add('gmail_list_messages');
      selectedNames.add('gmail_create_draft');
      selectedNames.add('gmail_send_email');
      selectedNames.add('calendar_list_events');
      selectedNames.add('calendar_create_event');
    }

    // 6. Personal Finance & Expense Tracker
    if (
      /chi tiêu|thu chi|tiền|ăn |uống|đổ xăng|xăng|mua |hóa đơn|bill|lương|thu nhập|thống kê|ngân sách|\d+\s*(?:k|tr|triệu|nghìn|ngàn|củ|cành|đ|vnd)\b/.test(
        lower,
      )
    ) {
      selectedNames.add('record_transaction');
      selectedNames.add('get_financial_summary');
    }

    // 7. URL Reader & Bookmarks (Second Brain)
    if (/https?:\/\/|link|url|bài viết|bài báo|trang web|website|bookmark|đọc sau|lưu lại|ghi chú|tìm lại|#/.test(lower)) {
      selectedNames.add('fetch_url');
      selectedNames.add('save_bookmark');
      selectedNames.add('search_bookmarks');
    }

    // 8. VietQR & System Monitor
    if (
      /qr|vietqr|chuyển khoản|stk|ngân hàng|vcb|vietcombank|mb|tcb|techcombank|acb|bidv|vpbank|tpbank|ram|cpu|uptime|server|máy tính|hệ thống|tài nguyên/.test(
        lower,
      )
    ) {
      selectedNames.add('generate_vietqr');
      selectedNames.add('system_status');
    }

    const result: AgentTool[] = [];
    for (const name of selectedNames) {
      const t = this.tools.get(name);
      if (t) result.push(t);
    }
    return result;
  }
}
