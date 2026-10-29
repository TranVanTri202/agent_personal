import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Paragraph, TextRun, Packer } from 'docx';
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
      objectKey,
      buffer,
      mimeType: contentType,
      originalName: `media-${Date.now()}`,
    });
  }
}
