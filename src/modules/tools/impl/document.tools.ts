import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { FilesService } from '../../files/files.service';

@Injectable()
export class CreateExcelTool implements AgentTool {
  name = 'create_excel';
  description = 'Tạo bảng tính Excel (.xlsx) với các cột và dữ liệu dòng chỉ định, lưu vào storage và trả kết quả.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Tên file (ví dụ: cong_viec_tuan.xlsx)' },
      sheetName: { type: 'string', description: 'Tên sheet' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            header: { type: 'string', description: 'Tiêu đề cột' },
            key: { type: 'string', description: 'Mã trường' },
          },
          required: ['header', 'key'],
        },
        description: 'Danh sách các cột',
      },
      rows: {
        type: 'array',
        items: { type: 'object' },
        description: 'Danh sách dữ liệu dòng',
      },
    },
    required: ['columns', 'rows'],
  };

  constructor(private readonly filesService: FilesService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: any, context: ToolExecutionContext): Promise<any> {
    const res = await this.filesService.createExcel({
      ...input,
      ownerId: context.ownerId,
      taskId: context.taskId,
    });
    return {
      success: true,
      fileId: res.file.id,
      filename: res.file.originalName,
      message: res.linkMessage,
      downloadUrl: res.downloadUrl,
    };
  }
}

@Injectable()
export class CreatePdfTool implements AgentTool {
  name = 'create_pdf';
  description = 'Tạo tài liệu PDF (.pdf) với tiêu đề và nội dung văn bản.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tiêu đề tài liệu' },
      content: { type: 'string', description: 'Nội dung văn bản (các dòng cách nhau bằng xuống dòng)' },
      filename: { type: 'string', description: 'Tên file .pdf' },
    },
    required: ['title', 'content'],
  };

  constructor(private readonly filesService: FilesService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: any, context: ToolExecutionContext): Promise<any> {
    const res = await this.filesService.createPdf({
      ...input,
      ownerId: context.ownerId,
      taskId: context.taskId,
    });
    return {
      success: true,
      fileId: res.file.id,
      filename: res.file.originalName,
      message: res.linkMessage,
      downloadUrl: res.downloadUrl,
    };
  }
}

@Injectable()
export class CreateWordTool implements AgentTool {
  name = 'create_word';
  description = 'Tạo tài liệu Word (.docx) với tiêu đề và danh sách các đoạn văn.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tiêu đề tài liệu' },
      paragraphs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Các đoạn văn trong tài liệu',
      },
      filename: { type: 'string', description: 'Tên file .docx' },
    },
    required: ['title', 'paragraphs'],
  };

  constructor(private readonly filesService: FilesService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: any, context: ToolExecutionContext): Promise<any> {
    const res = await this.filesService.createWord({
      ...input,
      ownerId: context.ownerId,
      taskId: context.taskId,
    });
    return {
      success: true,
      fileId: res.file.id,
      filename: res.file.originalName,
      message: res.linkMessage,
      downloadUrl: res.downloadUrl,
    };
  }
}
