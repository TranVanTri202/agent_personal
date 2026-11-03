import { Global, Module } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
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
import { ImageGenerationModule } from '../image-generation/image-generation.module';

@Global()
@Module({
  imports: [ImageGenerationModule],
  providers: [
    CreateExcelTool,
    CreatePdfTool,
    CreateWordTool,
    ReadDocumentTool,
    MemorySaveTool,
    MemorySearchTool,
    MemoryDeleteTool,
    WebSearchTool,
    FetchUrlTool,
    ExpenseRecordTool,
    ExpenseSummaryTool,
    BookmarkSaveTool,
    BookmarkSearchTool,
    CalendarListEventsTool,
    CalendarCreateEventTool,
    VietQrTool,
    SystemStatusTool,
    CreateReminderTool,
    ListRemindersTool,
    GetReminderTool,
    CancelReminderTool,
    RescheduleReminderTool,
    GmailListMessagesTool,
    GmailCreateDraftTool,
    GmailSendEmailTool,
    GenerateImageTool,
    EditImageTool,
    ResendExistingMediaTool,
    AnalyzeExistingImageTool,
    GetRecentMediaTool,
    GetMediaMetadataTool,
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
