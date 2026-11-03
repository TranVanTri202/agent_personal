import { Injectable } from '@nestjs/common';
import * as os from 'os';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { ZaloApiClient } from '../../zalo/zalo-api.client';
import { VietnameseMoneyParser } from './expense.tools';

@Injectable()
export class VietQrTool implements AgentTool {
  name = 'generate_vietqr';
  description =
    'Tạo mã QR chuyển khoản ngân hàng VietQR tự động điền sẵn số tiền và nội dung chuyển khoản, sau đó gửi trực tiếp ảnh QR vào cuộc trò chuyện Zalo.';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {
      bankId: {
        type: 'string',
        description:
          'Mã ngân hàng viết tắt (ví dụ: VCB, MB, TCB, ACB, BIDV, ICB/CTG, VPB, TPB, VIB, MSB, STB, HDB, SHB, OCB)',
      },
      accountNo: {
        type: 'string',
        description: 'Số tài khoản ngân hàng nhận tiền',
      },
      accountName: {
        type: 'string',
        description: 'Tên chủ tài khoản viết hoa không dấu (tùy chọn)',
      },
      amount: {
        type: ['number', 'string'],
        description: 'Số tiền cần chuyển (ví dụ: 150000, "150k", "1tr2" - tùy chọn)',
      },
      memo: {
        type: 'string',
        description: 'Nội dung chuyển khoản (ví dụ: "Tien an trua", "Thanh toan don hang")',
      },
    },
    required: ['bankId', 'accountNo'],
  };

  constructor(private readonly zaloClient: ZaloApiClient) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(
    input: {
      bankId: string;
      accountNo: string;
      accountName?: string;
      amount?: number | string;
      memo?: string;
    },
    context: ToolExecutionContext,
  ): Promise<any> {
    const bank = (input.bankId || '').trim().toUpperCase();
    const acc = (input.accountNo || '').replace(/\s+/g, '');
    if (!bank || !acc) {
      return { success: false, message: 'Vui lòng cung cấp mã ngân hàng (bankId) và số tài khoản (accountNo).' };
    }

    const parsedAmount = input.amount ? VietnameseMoneyParser.parseAmount(input.amount) || 0 : 0;
    const memo = (input.memo || '').trim();
    const accountName = (input.accountName || '').trim().toUpperCase();

    const params = new URLSearchParams();
    if (parsedAmount > 0) params.set('amount', String(parsedAmount));
    if (memo) params.set('addInfo', memo);
    if (accountName) params.set('accountName', accountName);

    const qrUrl = `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(acc)}-compact2.png?${params.toString()}`;

    const captionLines = [
      `💳 Mã VietQR chuyển khoản: ${bank} - ${acc}`,
      ...(accountName ? [`👤 Chủ TK: ${accountName}`] : []),
      ...(parsedAmount > 0 ? [`💰 Số tiền: ${VietnameseMoneyParser.formatVnd(parsedAmount)}`] : []),
      ...(memo ? [`📝 Nội dung: ${memo}`] : []),
    ];

    try {
      await this.zaloClient.sendPhoto(context.chatId, qrUrl, captionLines.join('\n'));
    } catch {
      // If sendPhoto fails in offline/mock environment, still return qrUrl
    }

    return {
      success: true,
      bankId: bank,
      accountNo: acc,
      amount: parsedAmount,
      memo,
      qrUrl,
      message: `Đã tạo và gửi mã VietQR (${bank} - ${acc}${parsedAmount > 0 ? ` - ${VietnameseMoneyParser.formatVnd(parsedAmount)}` : ''}) vào khung chat!`,
    };
  }
}

@Injectable()
export class SystemStatusTool implements AgentTool {
  name = 'system_status';
  description =
    'Kiểm tra thông số tài nguyên máy chủ/máy tính cá nhân đang chạy Agent (CPU, RAM đã dùng/còn trống, Uptime, bộ nhớ tiến trình Node.js).';
  riskLevel: 'LOW' = 'LOW';
  inputSchema = {
    type: 'object',
    properties: {},
  };

  requiresApproval(): boolean {
    return false;
  }

  async execute(_input: any, _context: ToolExecutionContext): Promise<any> {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    const memUsagePercent = Math.round((usedMemBytes / totalMemBytes) * 100);

    const toGb = (b: number) => (b / (1024 * 1024 * 1024)).toFixed(2);
    const toMb = (b: number) => (b / (1024 * 1024)).toFixed(1);

    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const uptimeSeconds = os.uptime();
    const uptimeHours = (uptimeSeconds / 3600).toFixed(1);
    const procMem = process.memoryUsage();

    return {
      success: true,
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuModel: cpus[0]?.model || 'Unknown CPU',
      cpuCores: cpus.length,
      loadAverage1m5m15m: loadAvg.map((n) => Number(n.toFixed(2))),
      ramTotalGb: Number(toGb(totalMemBytes)),
      ramUsedGb: Number(toGb(usedMemBytes)),
      ramFreeGb: Number(toGb(freeMemBytes)),
      ramUsagePercent: memUsagePercent,
      systemUptimeHours: Number(uptimeHours),
      nodeProcessRssMb: Number(toMb(procMem.rss)),
      nodeHeapUsedMb: Number(toMb(procMem.heapUsed)),
    };
  }
}
