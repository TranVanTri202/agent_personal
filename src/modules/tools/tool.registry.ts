import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentTool } from './tool.interface';
import { CreateExcelTool, CreatePdfTool, CreateWordTool } from './impl/document.tools';
import { MemorySaveTool, MemorySearchTool } from './impl/memory.tools';
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
    private readonly memorySaveTool: MemorySaveTool,
    private readonly memorySearchTool: MemorySearchTool,
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
    this.register(this.memorySaveTool);
    this.register(this.memorySearchTool);
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

  getOpenAIToolsSchema(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.listTools().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
