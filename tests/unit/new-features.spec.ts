import { MemorySaveTool, MemorySearchTool, MemoryDeleteTool } from '../../src/modules/tools/impl/memory.tools';
import { WebSearchTool, FetchUrlTool } from '../../src/modules/tools/impl/web.tools';
import { VietnameseMoneyParser, ExpenseRecordTool, ExpenseSummaryTool } from '../../src/modules/tools/impl/expense.tools';
import { BookmarkSaveTool, BookmarkSearchTool } from '../../src/modules/tools/impl/bookmark.tools';
import { VietQrTool, SystemStatusTool } from '../../src/modules/tools/impl/utility.tools';
import { ReminderTimeParser } from '../../src/modules/scheduler/reminder-time-parser';
import { ZaloEventNormalizer } from '../../src/modules/zalo/zalo-event.normalizer';

describe('New Personal Agent Features Suite', () => {
  describe('1. Long-term Memory Tools (Save, Multi-keyword Search, Delete)', () => {
    const mockMemories: any[] = [];
    const mockPrisma: any = {
      memory: {
        findFirst: jest.fn(async ({ where }: any) => {
          return mockMemories.find(
            (m) =>
              m.ownerId === where.ownerId &&
              m.text.toLowerCase() === where.text.equals.toLowerCase(),
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const item = { id: `mem-${mockMemories.length + 1}`, ...data, updatedAt: new Date() };
          mockMemories.push(item);
          return item;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const item = mockMemories.find((m) => m.id === where.id);
          Object.assign(item, data);
          return item;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return mockMemories.filter((m) => m.ownerId === where.ownerId);
        }),
        delete: jest.fn(async ({ where }: any) => {
          const idx = mockMemories.findIndex((m) => m.id === where.id);
          if (idx >= 0) mockMemories.splice(idx, 1);
        }),
      },
    };

    const saveTool = new MemorySaveTool(mockPrisma);
    const searchTool = new MemorySearchTool(mockPrisma);
    const deleteTool = new MemoryDeleteTool(mockPrisma);
    const ctx = { ownerId: 'owner-1', chatId: 'chat-1', conversationId: 'conv-1', taskId: 'task-1' };

    beforeEach(() => {
      mockMemories.length = 0;
    });

    it('saves new memory and deduplicates identical memory while upgrading importance', async () => {
      const res1 = await saveTool.execute(
        { text: 'Anh Trí bị dị ứng hải sản tôm cua', category: 'health', importance: 4 },
        ctx,
      );
      expect(res1.success).toBe(true);
      expect(mockMemories).toHaveLength(1);

      const res2 = await saveTool.execute(
        { text: 'Anh Trí bị dị ứng hải sản tôm cua', category: 'health', importance: 5 },
        ctx,
      );
      expect(res2.updated).toBe(true);
      expect(mockMemories).toHaveLength(1);
      expect(mockMemories[0].importance).toBe(5);
    });

    it('finds relevant memories using multi-keyword tokenized scoring', async () => {
      await saveTool.execute({ text: 'Thích uống cà phê đen không đường buổi sáng', category: 'preferences', importance: 4 }, ctx);
      await saveTool.execute({ text: 'Email công ty là tritv@company.vn', category: 'work', importance: 3 }, ctx);

      const searchRes = await searchTool.execute({ query: 'sáng uống đồ uống gì cà phê' }, ctx);
      expect(searchRes.success).toBe(true);
      expect(searchRes.count).toBeGreaterThan(0);
      expect(searchRes.memories[0].text).toContain('cà phê đen');
    });

    it('deletes memory by ID prefix or keyword', async () => {
      const created = await saveTool.execute({ text: 'Số xe cũ là 29A-12345', category: 'personal' }, ctx);
      const delRes = await deleteTool.execute({ memoryId: created.id }, ctx);
      expect(delRes.success).toBe(true);
      expect(mockMemories).toHaveLength(0);
    });
  });

  describe('2. Web Search & Fetch URL HTML Extraction & SSRF Protection', () => {
    it('strips HTML and extracts readable text cleanly', () => {
      const rawHtml = `
        <html>
          <head><title>Giá vàng hôm nay &amp; Tỷ giá</title><style>body { color: red; }</style></head>
          <body>
            <nav>Menu điều hướng</nav>
            <article>
              <h1>Bản tin tài chính sáng nay</h1>
              <p>Giá vàng SJC tăng mạnh &quot;kỷ lục&quot; trong phiên giao dịch.</p>
            </article>
            <script>alert("xss")</script>
          </body>
        </html>
      `;
      const extracted = FetchUrlTool.extractReadableText(rawHtml);
      expect(extracted).toContain('Bản tin tài chính sáng nay');
      expect(extracted).toContain('Giá vàng SJC tăng mạnh "kỷ lục"');
      expect(extracted).not.toContain('alert("xss")');
      expect(extracted).not.toContain('Menu điều hướng');
    });

    it('blocks private IP URLs via SSRF protection in FetchUrlTool', async () => {
      const fetchTool = new FetchUrlTool({ warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any);
      const res = await fetchTool.execute(
        { url: 'http://127.0.0.1:8080/admin' },
        { ownerId: 'owner-1', chatId: 'chat-1' },
      );
      expect(res.success).toBe(false);
      expect(res.message).toContain('SSRF blocked');
    });
  });

  describe('3. Recurring Reminders Parser & Next Occurrence Calculation', () => {
    it('detects DAILY, WEEKLY, WEEKDAYS, MONTHLY recurrence rules from Vietnamese text', () => {
      expect(ReminderTimeParser.detectRecurrence('Nhắc uống thuốc lúc 8h tối hàng ngày')).toBe('DAILY');
      expect(ReminderTimeParser.detectRecurrence('Mỗi sáng lúc 7h nhắc tập thể dục')).toBe('DAILY');
      expect(ReminderTimeParser.detectRecurrence('Nhắc họp giao ban lúc 9h thứ 2 đến thứ 6')).toBe('WEEKDAYS');
      expect(ReminderTimeParser.detectRecurrence('Nhắc gửi báo cáo hàng tuần')).toBe('WEEKLY');
      expect(ReminderTimeParser.detectRecurrence('Nhắc đóng tiền điện hàng tháng')).toBe('MONTHLY');
    });

    it('encodes and decodes recurrence tag inside reminder note non-destructively', () => {
      const encoded = ReminderTimeParser.encodeNoteWithRecurrence('Sau bữa ăn tối', 'DAILY');
      expect(encoded).toBe('[RECUR:DAILY] Sau bữa ăn tối');

      const decoded = ReminderTimeParser.extractRecurrenceFromNote(encoded);
      expect(decoded.recurrence).toBe('DAILY');
      expect(decoded.cleanNote).toBe('Sau bữa ăn tối');
    });

    it('computes future nextDueAt for recurring reminders', () => {
      const base = new Date(Date.now() + 60_000);
      const nextDaily = ReminderTimeParser.computeNextDueAt(base, 'DAILY');
      expect(nextDaily).not.toBeNull();
      expect(nextDaily!.getTime() - base.getTime()).toBe(24 * 3600 * 1000);
    });
  });

  describe('4. ZaloEventNormalizer Inbound FILE and VOICE Support', () => {
    const normalizer = new ZaloEventNormalizer();

    it('normalizes incoming FILE attachment messages', () => {
      const raw = {
        event_name: 'message.file.received',
        message: {
          message_id: 'msg-file-101',
          from: { id: 'user-1', display_name: 'Anh Trí' },
          chat: { id: 'chat-1', chat_type: 'PRIVATE' },
          file_url: 'https://cdn.zalo.me/docs/hop-dong.pdf',
          file_name: 'hop-dong.pdf',
          text: 'Tóm tắt file này giúp anh',
        },
      };

      const norm = normalizer.normalize(raw);
      expect(norm).not.toBeNull();
      expect(norm!.type).toBe('FILE');
      expect(norm!.fileUrl).toBe('https://cdn.zalo.me/docs/hop-dong.pdf');
      expect(norm!.fileName).toBe('hop-dong.pdf');
      expect(norm!.attachments[0].type).toBe('FILE');
    });
  });

  describe('5. Personal Finance & Expense Tracker (VietnameseMoneyParser & Tools)', () => {
    it('parses natural Vietnamese currency shorthand accurately', () => {
      expect(VietnameseMoneyParser.parseAmount('55k')).toBe(55_000);
      expect(VietnameseMoneyParser.parseAmount('1tr2')).toBe(1_200_000);
      expect(VietnameseMoneyParser.parseAmount('1.5 triệu')).toBe(1_500_000);
      expect(VietnameseMoneyParser.parseAmount('25tr')).toBe(25_000_000);
      expect(VietnameseMoneyParser.parseAmount('120 nghìn')).toBe(120_000);
      expect(VietnameseMoneyParser.parseAmount(80000)).toBe(80_000);
    });

    it('records expenses and computes financial summary accurately', async () => {
      const store: any[] = [];
      const mockPrisma: any = {
        memory: {
          create: jest.fn(async ({ data }: any) => {
            const rec = { id: `tx-${store.length + 1}`, ...data, createdAt: new Date() };
            store.push(rec);
            return rec;
          }),
          findMany: jest.fn(async () => store),
        },
      };
      const mockFiles: any = { createExcel: jest.fn() };

      const recordTool = new ExpenseRecordTool(mockPrisma);
      const summaryTool = new ExpenseSummaryTool(mockPrisma, mockFiles);
      const ctx = { ownerId: 'owner-1', chatId: 'chat-1', conversationId: 'conv-1', taskId: 'task-1' };

      await recordTool.execute({ amount: '55k', category: 'an_uong', note: 'Ăn trưa phở bò' }, ctx);
      await recordTool.execute({ amount: '80k', category: 'di_chuyen', note: 'Đổ xăng' }, ctx);
      await recordTool.execute({ amount: '25tr', type: 'INCOME', category: 'thu_nhap', note: 'Lương tháng 11' }, ctx);

      const summary = await summaryTool.execute({ period: 'month' }, ctx);
      expect(summary.success).toBe(true);
      expect(summary.totalExpense).toBe(135_000);
      expect(summary.totalIncome).toBe(25_000_000);
      expect(summary.netBalance).toBe(24_865_000);
      expect(summary.byCategory.an_uong).toBe(55_000);
      expect(summary.byCategory.di_chuyen).toBe(80_000);
    });
  });

  describe('6. Second Brain Bookmarks, VietQR & System Monitor', () => {
    it('saves and searches bookmarks by keyword and #tag', async () => {
      const store: any[] = [];
      const mockPrisma: any = {
        memory: {
          create: jest.fn(async ({ data }: any) => {
            const rec = { id: `bm-${store.length + 1}`, ...data, createdAt: new Date() };
            store.push(rec);
            return rec;
          }),
          findMany: jest.fn(async () => store),
        },
      };

      const saveBm = new BookmarkSaveTool(mockPrisma);
      const searchBm = new BookmarkSearchTool(mockPrisma);
      const ctx = { ownerId: 'owner-1', chatId: 'chat-1' };

      await saveBm.execute(
        {
          url: 'https://docs.nestjs.com/techniques/queues',
          title: 'Hướng dẫn BullMQ trên NestJS',
          summary: 'Tối ưu hàng đợi Redis cho ứng dụng Node.js',
          tags: ['nestjs', 'redis'],
        },
        ctx,
      );

      const found = await searchBm.execute({ query: 'bullmq', tag: 'nestjs' }, ctx);
      expect(found.success).toBe(true);
      expect(found.count).toBe(1);
      expect(found.bookmarks[0].title).toContain('BullMQ');
    });

    it('generates VietQR payment URL and checks system status', async () => {
      const mockZalo: any = { sendPhoto: jest.fn().mockResolvedValue({}) };
      const qrTool = new VietQrTool(mockZalo);
      const qrRes = await qrTool.execute(
        { bankId: 'VCB', accountNo: '0123456789', amount: '150k', memo: 'Tien ca phe', accountName: 'TRAN VAN TRI' },
        { ownerId: 'owner-1', chatId: 'chat-1' },
      );

      expect(qrRes.success).toBe(true);
      expect(qrRes.amount).toBe(150_000);
      expect(qrRes.qrUrl).toContain('https://img.vietqr.io/image/VCB-0123456789-compact2.png');
      expect(mockZalo.sendPhoto).toHaveBeenCalledTimes(1);

      const sysTool = new SystemStatusTool();
      const sysRes = await sysTool.execute({}, { ownerId: 'owner-1', chatId: 'chat-1' });
      expect(sysRes.success).toBe(true);
      expect(sysRes.cpuCores).toBeGreaterThan(0);
      expect(sysRes.ramTotalGb).toBeGreaterThan(0);
    });
  });
});
