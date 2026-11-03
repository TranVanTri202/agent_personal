import { Global, Module } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
import { CreateExcelTool, CreatePdfTool, CreateWordTool, ReadDocumentTool } from './impl/document.tools';
import { MemorySaveTool, MemorySearchTool, MemoryDeleteTool } from './impl/memory.tools';
import { WebSearchTool, FetchUrlTool } from './impl/web.tools';
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
