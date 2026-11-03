import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Paragraph, TextRun, Packer } from 'docx';
import * as zlib from 'zlib';
import axios from 'axios';
import { StorageService } from '../storage/storage.service';
import { SsrfValidator } from '../../common/security/ssrf.validator';
import { StoredFile } from '@prisma/client';

@Injectable()
export class FilesService {
  constructor(private readonly storageService: StorageService) {}

  async createExcel(params: {
    sheetName?: string;
    columns: Array<{ header: string; key: string; width?: number }>;
    rows: Array<Record<string, any>>;
    filename?: string;
    ownerId?: string;
    taskId?: string;
  }): Promise<{ file: StoredFile; linkMessage: string; downloadUrl?: string }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Personal Zalo AI Agent';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(params.sheetName || 'Sheet1');
    worksheet.columns = params.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 20,
    }));

    for (const row of params.rows) {
      worksheet.addRow(row);
    }

    // Style the header row
    worksheet.getRow(1).font = { bold: true };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const originalName = params.filename || `report-${Date.now()}.xlsx`;
    const objectKey = `outputs/excel/${Date.now()}-${originalName}`;

    const file = await this.storageService.saveFile({
      ownerId: params.ownerId,
      taskId: params.taskId,
      objectKey,
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalName,
    });

    const linkInfo = await this.storageService.getDownloadLink(file.id);

    return {
      file,
      linkMessage: linkInfo.url
        ? `Đã tạo file Excel "${originalName}" thành công!\n${linkInfo.message}`
        : `Đã tạo file Excel "${originalName}" (${buffer.length} bytes) và lưu tại Local Storage.\n${linkInfo.message}`,
      downloadUrl: linkInfo.url,
    };
  }

  async createPdf(params: {
    title: string;
    content: string;
    filename?: string;
    ownerId?: string;
    taskId?: string;
  }): Promise<{ file: StoredFile; linkMessage: string; downloadUrl?: string }> {
    const pdfDoc = await PDFDocument.create();
    const timesRoman = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { height } = page.getSize();

    page.drawText(params.title, {
      x: 50,
      y: height - 50,
      size: 20,
      font: timesRoman,
      color: rgb(0.1, 0.1, 0.1),
    });

    // Draw content lines
    const lines = params.content.split('\n');
    let currentY = height - 90;
    for (const line of lines) {
      if (currentY < 50) break; // avoid page overflow for now
      page.drawText(line, {
        x: 50,
        y: currentY,
        size: 11,
        font: timesRoman,
        color: rgb(0.2, 0.2, 0.2),
      });
      currentY -= 18;
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const originalName = params.filename || `document-${Date.now()}.pdf`;
    const objectKey = `outputs/pdf/${Date.now()}-${originalName}`;

    const file = await this.storageService.saveFile({
      ownerId: params.ownerId,
      taskId: params.taskId,
      objectKey,
      buffer,
      mimeType: 'application/pdf',
      originalName,
    });

    const linkInfo = await this.storageService.getDownloadLink(file.id);

    return {
      file,
      linkMessage: linkInfo.url
        ? `Đã tạo file PDF "${originalName}" thành công!\n${linkInfo.message}`
        : `Đã tạo file PDF "${originalName}" (${buffer.length} bytes) và lưu tại Local Storage.\n${linkInfo.message}`,
      downloadUrl: linkInfo.url,
    };
  }

  async createWord(params: {
    title: string;
    paragraphs: string[];
    filename?: string;
    ownerId?: string;
    taskId?: string;
  }): Promise<{ file: StoredFile; linkMessage: string; downloadUrl?: string }> {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: params.title,
                  bold: true,
                  size: 32,
                }),
              ],
            }),
            ...params.paragraphs.map(
              (p) =>
                new Paragraph({
                  children: [new TextRun({ text: p, size: 24 })],
                }),
            ),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const originalName = params.filename || `document-${Date.now()}.docx`;
    const objectKey = `outputs/word/${Date.now()}-${originalName}`;

    const file = await this.storageService.saveFile({
      ownerId: params.ownerId,
      taskId: params.taskId,
      objectKey,
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName,
    });

    const linkInfo = await this.storageService.getDownloadLink(file.id);

    return {
      file,
      linkMessage: linkInfo.url
        ? `Đã tạo file Word "${originalName}" thành công!\n${linkInfo.message}`
        : `Đã tạo file Word "${originalName}" (${buffer.length} bytes) và lưu tại Local Storage.\n${linkInfo.message}`,
      downloadUrl: linkInfo.url,
    };
  }

  async downloadMediaSafely(
    url: string,
    ownerId?: string,
    mimeType = 'application/octet-stream',
    originalName?: string,
    conversationId?: string,
  ): Promise<StoredFile> {
    await SsrfValidator.assertSafeUrl(url);

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    const buffer = Buffer.from(res.data);
    const contentType = String(res.headers['content-type'] || mimeType);
    const objectKey = `inputs/${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    return this.storageService.saveFile({
      ownerId,
      conversationId,
      objectKey,
      buffer,
      mimeType: contentType,
      originalName: originalName || `media-${Date.now()}`,
    });
  }

  /**
   * Reads and extracts structured text/table content from an uploaded or stored document
   * (.xlsx, .docx, .pdf, .csv, .txt, .json, .md).
   */
  async extractDocumentContent(params: {
    fileId?: string;
    fileUrl?: string;
    ownerId?: string;
    conversationId?: string;
    maxChars?: number;
  }): Promise<{
    success: boolean;
    fileId?: string;
    filename?: string;
    mimeType?: string;
    content?: string;
    truncated?: boolean;
    message?: string;
  }> {
    const maxChars = Math.min(25000, Math.max(1000, params.maxChars || 12000));
    let buffer: Buffer | undefined;
    let filename = 'document';
    let mimeType = 'application/octet-stream';
    let resolvedFileId = params.fileId;

    if (params.fileId) {
      const fileData = await this.storageService.getFileBuffer(params.fileId);
      if (fileData) {
        buffer = fileData.buffer;
        filename = fileData.originalName;
        mimeType = fileData.mimeType;
        resolvedFileId = fileData.file.id;
      }
    }

    if (!buffer && params.fileUrl) {
      const saved = await this.downloadMediaSafely(
        params.fileUrl,
        params.ownerId,
        'application/octet-stream',
        undefined,
        params.conversationId,
      );
      const fileData = await this.storageService.getFileBuffer(saved.id);
      if (fileData) {
        buffer = fileData.buffer;
        filename = fileData.originalName;
        mimeType = fileData.mimeType;
        resolvedFileId = saved.id;
      }
    }

    // Fallback: pick latest active non-image file of owner
    if (!buffer && params.ownerId) {
      const recentFiles = await this.storageService.listFiles(params.ownerId);
      const docFile = recentFiles.find((f) => !f.mimeType.startsWith('image/')) || recentFiles[0];
      if (docFile) {
        const fileData = await this.storageService.getFileBuffer(docFile.id);
        if (fileData) {
          buffer = fileData.buffer;
          filename = fileData.originalName;
          mimeType = fileData.mimeType;
          resolvedFileId = docFile.id;
        }
      }
    }

    if (!buffer) {
      return {
        success: false,
        message: 'Không tìm thấy tệp tài liệu khả dụng để đọc nội dung.',
      };
    }

    const lowerName = filename.toLowerCase();
    const lowerMime = mimeType.toLowerCase();
    let extracted = '';

    // 1. Excel (.xlsx)
    if (
      lowerName.endsWith('.xlsx') ||
      lowerMime.includes('spreadsheetml') ||
      lowerMime.includes('excel')
    ) {
      extracted = await this.parseExcelBuffer(buffer);
    }
    // 2. Word (.docx)
    else if (
      lowerName.endsWith('.docx') ||
      lowerMime.includes('wordprocessingml')
    ) {
      extracted = this.parseDocxBuffer(buffer);
    }
    // 3. PDF (.pdf)
    else if (lowerName.endsWith('.pdf') || lowerMime.includes('application/pdf')) {
      extracted = await this.parsePdfBuffer(buffer);
    }
    // 4. Plain text / CSV / JSON / Markdown
    else {
      extracted = buffer.toString('utf-8');
    }

    const clean = extracted.trim();
    return {
      success: true,
      fileId: resolvedFileId,
      filename,
      mimeType,
      content: clean.slice(0, maxChars),
      truncated: clean.length > maxChars,
    };
  }

  private async parseExcelBuffer(buffer: Buffer): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheetsOutput: string[] = [];

    workbook.eachSheet((worksheet) => {
      const rows: string[] = [`### Sheet: ${worksheet.name}`];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber > 200) return;
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        const line = values
          .map((v: any) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return String(v.text);
            if (typeof v === 'object' && v.result !== undefined) return String(v.result);
            return String(v);
          })
          .join(' | ');
        rows.push(`Row ${rowNumber}: ${line}`);
      });
      sheetsOutput.push(rows.join('\n'));
    });

    return sheetsOutput.join('\n\n');
  }

  private parseDocxBuffer(buffer: Buffer): string {
    // A .docx file is a ZIP archive containing word/document.xml
    try {
      const xml = this.extractZipEntryAsUtf8(buffer, 'word/document.xml');
      if (xml) {
        return xml
          .replace(/<\/w:p>/gi, '\n')
          .replace(/<w:tab\/>/gi, '\t')
          .replace(/<w:br[^/>]*\/>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    } catch {
      // Fallback
    }
    return buffer.toString('utf-8');
  }

  private extractZipEntryAsUtf8(zipBuffer: Buffer, targetFileName: string): string | null {
    let offset = 0;
    while (offset + 30 <= zipBuffer.length) {
      const signature = zipBuffer.readUInt32LE(offset);
      if (signature !== 0x04034b50) break; // Local file header signature

      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

      const fileNameStart = offset + 30;
      const entryName = zipBuffer.subarray(fileNameStart, fileNameStart + fileNameLength).toString('utf-8');
      const dataStart = fileNameStart + fileNameLength + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      if (entryName === targetFileName && dataEnd <= zipBuffer.length) {
        const compressedData = zipBuffer.subarray(dataStart, dataEnd);
        if (compressionMethod === 0) {
          return compressedData.toString('utf-8');
        } else if (compressionMethod === 8) {
          return zlib.inflateRawSync(compressedData).toString('utf-8');
        }
      }
      offset = dataEnd;
    }
    return null;
  }

  private async parsePdfBuffer(buffer: Buffer): Promise<string> {
    const pagesInfo: string[] = [];
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pagesInfo.push(`[PDF Document - Số trang: ${pdfDoc.getPageCount()}]`);
      const title = pdfDoc.getTitle();
      if (title) pagesInfo.push(`Tiêu đề: ${title}`);
    } catch {
      // ignore metadata error
    }

    // Extract literal text strings (...) from PDF streams (both uncompressed and FlateDecode)
    const rawStr = buffer.toString('latin1');
    const textChunks: string[] = [];

    const extractLiterals = (content: string) => {
      const regex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj|\[([^\]]+)\]\s*TJ/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        if (m[1]) {
          textChunks.push(m[1].replace(/\\([()\\])/g, '$1'));
        } else if (m[2]) {
          const inner = m[2].match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g);
          if (inner) {
            textChunks.push(inner.map((s) => s.slice(1, -1).replace(/\\([()\\])/g, '$1')).join(''));
          }
        }
      }
    };

    extractLiterals(rawStr);

    // Also try decompressing FlateDecode streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let sm: RegExpExecArray | null;
    while ((sm = streamRegex.exec(rawStr)) !== null) {
      try {
        const inflated = zlib.inflateSync(Buffer.from(sm[1], 'latin1')).toString('latin1');
        extractLiterals(inflated);
      } catch {
        // not a zlib stream
      }
    }

    if (textChunks.length > 0) {
      pagesInfo.push(textChunks.join(' ').replace(/\s+/g, ' ').trim());
    }
    return pagesInfo.join('\n');
  }
}
