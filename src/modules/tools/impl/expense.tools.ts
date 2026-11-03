import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../../files/files.service';

export interface FinanceTransactionPayload {
  type: 'EXPENSE' | 'INCOME';
  amount: number;
  category: string;
  note: string;
  dateIso: string;
}

export class VietnameseMoneyParser {
  /**
   * Parses natural Vietnamese currency strings like "55k", "1tr2", "1.5 triệu", "250 nghìn", "80000"
   * into an integer VND amount.
   */
  static parseAmount(raw: string | number): number | null {
    if (typeof raw === 'number') {
      return raw > 0 ? Math.round(raw) : null;
    }
    const clean = String(raw || '')
      .toLowerCase()
      .replace(/,/g, '.')
      .trim();

    // e.g. "1tr2", "1m5", "2củ5" -> 1,200,000
    const shorthandMillion = clean.match(/^(\d+)\s*(?:tr|triệu|m|củ)\s*(\d+)$/);
    if (shorthandMillion) {
      const major = parseInt(shorthandMillion[1], 10);
      const minorStr = shorthandMillion[2];
      const minor = parseInt(minorStr, 10) * Math.pow(10, 6 - minorStr.length);
      return major * 1_000_000 + minor;
    }

    // e.g. "1.5tr", "25 triệu", "2 củ"
    const millionMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(?:tr|triệu|m|củ)$/);
    if (millionMatch) {
      return Math.round(parseFloat(millionMatch[1]) * 1_000_000);
    }

    // e.g. "55k", "120 nghìn", "80 ngàn", "50 cành"
    const thousandMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(?:k|nghìn|ngàn|cành)$/);
    if (thousandMatch) {
      return Math.round(parseFloat(thousandMatch[1]) * 1_000);
    }

    // Plain digits e.g. "55000" or "1.200.000"
    const digitsOnly = clean.replace(/[^\d]/g, '');
    if (digitsOnly) {
      const val = parseInt(digitsOnly, 10);
      if (val > 0 && val < 1000) {
        // If someone wrote "55" in expense context, treat as 55,000 VND
        return val * 1000;
      }
      return val > 0 ? val : null;
    }

    return null;
  }

  static formatVnd(amount: number): string {
    return `${Math.round(amount).toLocaleString('vi-VN')} ₫`;
  }
}

@Injectable()
export class ExpenseRecordTool implements AgentTool {
  name = 'record_transaction';
  description =
    'Ghi nhận một khoản chi tiêu hoặc thu nhập cá nhân vào sổ thu chi (ví dụ: "ăn trưa 55k", "đổ xăng 80k", "đóng tiền điện 1tr2", "nhận lương 25tr", hoặc từ hóa đơn/bill chụp ảnh).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      amount: {
        type: ['number', 'string'],
        description: 'Số tiền VNĐ hoặc chuỗi tiền tệ tiếng Việt (ví dụ: 55000, "55k", "1tr2")',
      },
      type: {
        type: 'string',
        enum: ['EXPENSE', 'INCOME'],
        description: 'Loại giao dịch: EXPENSE (chi tiêu - mặc định) hoặc INCOME (thu nhập)',
      },
      category: {
        type: 'string',
        enum: ['an_uong', 'di_chuyen', 'hoa_don', 'mua_sam', 'giai_tri', 'suc_khoe', 'nha_cua', 'thu_nhap', 'khac'],
        description: 'Danh mục thu chi (an_uong, di_chuyen, hoa_don, mua_sam, giai_tri, suc_khoe, nha_cua, thu_nhap, khac)',
      },
      note: {
        type: 'string',
        description: 'Mô tả khoản thu chi (ví dụ: "Ăn phở bò", "Đổ xăng A95", "Lương tháng 11")',
      },
      dateIso: {
        type: 'string',
        description: 'Thời điểm giao dịch ISO 8601 (tùy chọn, mặc định là hiện tại)',
      },
    },
    required: ['amount', 'note'],
  };

  constructor(private readonly prisma: PrismaService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: {
      amount: number | string;
      type?: 'EXPENSE' | 'INCOME';
      category?: string;
      note: string;
      dateIso?: string;
    },
    context: ToolExecutionContext,
  ): Promise<any> {
    const parsedAmount = VietnameseMoneyParser.parseAmount(input.amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return {
        success: false,
        message: `Số tiền "${input.amount}" không hợp lệ. Vui lòng nhập số tiền rõ ràng (VD: 55k, 1tr2).`,
      };
    }

    const txType: 'EXPENSE' | 'INCOME' = input.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
    const category = input.category || (txType === 'INCOME' ? 'thu_nhap' : 'an_uong');
    const dateIso = input.dateIso ? new Date(input.dateIso).toISOString() : new Date().toISOString();

    const payload: FinanceTransactionPayload = {
      type: txType,
      amount: parsedAmount,
      category,
      note: (input.note || '').trim(),
      dateIso,
    };

    const record = await this.prisma.memory.create({
      data: {
        ownerId: context.ownerId,
        category: 'finance_tx',
        text: JSON.stringify(payload),
        importance: 2,
        source: context.conversationId,
      },
    });

    // Compute today's total expense for helpful feedback
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayRecords = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        category: 'finance_tx',
        createdAt: { gte: startOfToday },
      },
    });

    let todayExpense = 0;
    for (const r of todayRecords) {
      try {
        const p = JSON.parse(r.text) as FinanceTransactionPayload;
        if (p.type === 'EXPENSE') todayExpense += p.amount;
      } catch {
        // ignore
      }
    }

    const formatted = VietnameseMoneyParser.formatVnd(parsedAmount);
    const formattedToday = VietnameseMoneyParser.formatVnd(todayExpense);

    return {
      success: true,
      transactionId: record.id,
      type: txType,
      amount: parsedAmount,
      formattedAmount: formatted,
      category,
      note: payload.note,
      todayTotalExpense: todayExpense,
      formattedTodayTotalExpense: formattedToday,
      message:
        txType === 'EXPENSE'
          ? `💸 Đã ghi nhận khoản chi **${formatted}** (${payload.note} - [${category}]).\n📊 Tổng chi tiêu hôm nay: **${formattedToday}**.`
          : `💰 Đã ghi nhận khoản thu **+${formatted}** (${payload.note}).`,
    };
  }
}

@Injectable()
export class ExpenseSummaryTool implements AgentTool {
  name = 'get_financial_summary';
  description =
    'Xem thống kê chi tiêu và thu nhập cá nhân theo khoảng thời gian (hôm nay, tuần này, tháng này, tất cả) và tùy chọn xuất báo cáo ra file Excel (.xlsx).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'week', 'month', 'all'],
        description: 'Kỳ thống kê: today (hôm nay), week (7 ngày qua), month (tháng này - mặc định), all (tất cả)',
      },
      exportExcel: {
        type: 'boolean',
        description: 'Đặt true nếu người dùng muốn xuất bảng kê chi tiêu ra file Excel (.xlsx)',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
  ) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: { period?: 'today' | 'week' | 'month' | 'all'; exportExcel?: boolean },
    context: ToolExecutionContext,
  ): Promise<any> {
    const period = input.period || 'month';
    const now = new Date();
    let startDate: Date | undefined;

    if (period === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const rawRecords = await this.prisma.memory.findMany({
      where: {
        ownerId: context.ownerId,
        category: 'finance_tx',
        ...(startDate ? { createdAt: { gte: startDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const transactions: Array<FinanceTransactionPayload & { id: string }> = [];
    let totalExpense = 0;
    let totalIncome = 0;
    const byCategory: Record<string, number> = {};

    for (const r of rawRecords) {
      try {
        const parsed = JSON.parse(r.text) as FinanceTransactionPayload;
        transactions.push({ id: r.id, ...parsed });
        if (parsed.type === 'INCOME') {
          totalIncome += parsed.amount;
        } else {
          totalExpense += parsed.amount;
          byCategory[parsed.category] = (byCategory[parsed.category] || 0) + parsed.amount;
        }
      } catch {
        // ignore malformed
      }
    }

    let excelDownloadMessage: string | undefined;
    let excelFileId: string | undefined;

    if (input.exportExcel && transactions.length > 0) {
      const excelRes = await this.filesService.createExcel({
        filename: `so-thu-chi-${period}-${Date.now()}.xlsx`,
        sheetName: 'SoThuChi',
        ownerId: context.ownerId,
        taskId: context.taskId,
        columns: [
          { header: 'Thời gian', key: 'date', width: 22 },
          { header: 'Loại', key: 'type', width: 14 },
          { header: 'Danh mục', key: 'category', width: 18 },
          { header: 'Số tiền (VNĐ)', key: 'amount', width: 18 },
          { header: 'Nội dung', key: 'note', width: 35 },
        ],
        rows: transactions.map((t) => ({
          date: new Date(t.dateIso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
          type: t.type === 'INCOME' ? 'Thu nhập' : 'Chi tiêu',
          category: t.category,
          amount: t.amount,
          note: t.note,
        })),
      });
      excelDownloadMessage = excelRes.linkMessage;
      excelFileId = excelRes.file.id;
    }

    const catBreakdown = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `• ${cat}: ${VietnameseMoneyParser.formatVnd(amt)}`)
      .join('\n');

    return {
      success: true,
      period,
      transactionCount: transactions.length,
      totalExpense,
      formattedTotalExpense: VietnameseMoneyParser.formatVnd(totalExpense),
      totalIncome,
      formattedTotalIncome: VietnameseMoneyParser.formatVnd(totalIncome),
      netBalance: totalIncome - totalExpense,
      formattedNetBalance: VietnameseMoneyParser.formatVnd(totalIncome - totalExpense),
      byCategory,
      recentTransactions: transactions.slice(0, 10),
      fileId: excelFileId,
      message:
        `📊 **THỐNG KÊ THU CHI (${period.toUpperCase()}):**\n` +
        `• Tổng thu: **${VietnameseMoneyParser.formatVnd(totalIncome)}**\n` +
        `• Tổng chi: **${VietnameseMoneyParser.formatVnd(totalExpense)}**\n` +
        `• Chênh lệch: **${VietnameseMoneyParser.formatVnd(totalIncome - totalExpense)}**\n` +
        (catBreakdown ? `\nPhân bổ chi tiêu:\n${catBreakdown}` : '') +
        (excelDownloadMessage ? `\n\n${excelDownloadMessage}` : ''),
    };
  }
}
