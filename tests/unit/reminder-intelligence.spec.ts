import { ReminderTimeParser } from '../../src/modules/scheduler/reminder-time-parser';
import { SchedulerService } from '../../src/modules/scheduler/scheduler.service';
import { ReminderProcessor } from '../../src/modules/scheduler/reminder.processor';
import { ConversationStateService } from '../../src/modules/conversation-intelligence/conversation-state.service';
import { ContextResolverService } from '../../src/modules/conversation-intelligence/context-resolver.service';
import {
  CreateReminderTool,
  RescheduleReminderTool,
  CancelReminderTool,
  ListRemindersTool,
  GetReminderTool,
} from '../../src/modules/tools/impl/reminder.tools';

describe('Reminder & Conversation Intelligence Subsystem', () => {
  const fixedAnchor = new Date('2026-10-29T10:00:00.000Z'); // Fixed anchor time

  describe('ReminderTimeParser', () => {
    it('should parse relative minutes accurately ("10 phút nữa")', () => {
      const res = ReminderTimeParser.parse('10 phút nữa nhắc anh nộp báo cáo', fixedAnchor);
      expect(res.success).toBe(true);
      expect(res.dueAt?.toISOString()).toBe(new Date(fixedAnchor.getTime() + 10 * 60 * 1000).toISOString());
      expect(res.title).toContain('nộp báo cáo');
    });

    it('should parse relative hours ("2 tiếng nữa")', () => {
      const res = ReminderTimeParser.parse('2 tiếng nữa nhắc em họp team', fixedAnchor);
      expect(res.success).toBe(true);
      expect(res.dueAt?.toISOString()).toBe(new Date(fixedAnchor.getTime() + 2 * 3600 * 1000).toISOString());
      expect(res.title).toContain('họp team');
    });

    it('should parse "nửa tiếng nữa" as 30 minutes', () => {
      const res = ReminderTimeParser.parse('nửa tiếng nữa nhắc anh gọi cho khách hàng nhé', fixedAnchor);
      expect(res.success).toBe(true);
      expect(res.dueAt?.toISOString()).toBe(new Date(fixedAnchor.getTime() + 30 * 60 * 1000).toISOString());
      expect(res.title).toContain('khách hàng');
    });

    it('should parse reschedule expressions ("dời thêm 15 phút")', () => {
      const res = ReminderTimeParser.parse('dời thêm 15 phút nữa nhé', fixedAnchor);
      expect(res.success).toBe(true);
      expect(res.isReschedule).toBe(true);
      expect(res.extendMinutes).toBe(15);
      expect(res.dueAt?.toISOString()).toBe(new Date(fixedAnchor.getTime() + 15 * 60 * 1000).toISOString());
    });

    it('should parse cancellation intents ("hủy nhắc việc vừa rồi")', () => {
      const res = ReminderTimeParser.parse('hủy nhắc việc vừa rồi đi', fixedAnchor);
      expect(res.success).toBe(true);
      expect(res.isCancel).toBe(true);
    });

    it('should detect ambiguous times ("lát nữa nhắc anh")', () => {
      const res = ReminderTimeParser.parse('lát nữa nhắc anh uống thuốc nhé', fixedAnchor);
      expect(res.success).toBe(false);
      expect(res.isAmbiguous).toBe(true);
      expect(res.clarificationPrompt).toBeDefined();
    });

    it('should detect ambiguous future day phrases ("chiều mai nhắc anh")', () => {
      const res = ReminderTimeParser.parse('chiều mai nhắc anh gửi email', fixedAnchor);
      expect(res.success).toBe(false);
      expect(res.isAmbiguous).toBe(true);
      expect(res.clarificationPrompt).toContain('chiều mai');
    });
  });

  describe('ConversationStateService & ContextResolverService', () => {
    let stateService: ConversationStateService;
    let contextResolver: ContextResolverService;

    const mockPrisma: any = {
      conversationState: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockLogger: any = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    beforeEach(() => {
      stateService = new ConversationStateService(mockPrisma, mockLogger);
      contextResolver = new ContextResolverService(stateService, mockPrisma, mockLogger);
    });

    it('should resolve reminder reference from state when user asks "dời thêm 15 phút"', async () => {
      mockPrisma.conversationState.findUnique.mockResolvedValue({
        conversationId: 'conv-001',
        userId: 'user-001',
        chatId: 'chat-001',
        chatType: 'PRIVATE',
        lastReminderId: 'rem-uuid-999',
        lastEmailThreadIds: [],
        lastFileIds: [],
        lastImageIds: [],
        pendingClarification: null,
      });

      const res = await contextResolver.resolveContext('conv-001', 'user-001', 'chat-001', 'dời thêm 15 phút nữa nhé');
      expect(res.resolvedReminderId).toBe('rem-uuid-999');
      expect(res.injectedContextPrompt).toContain('rem-uuid-999');
    });

    it('should resolve email ordinal "cái thứ 2" to the second thread id', async () => {
      mockPrisma.conversationState.findUnique.mockResolvedValue({
        conversationId: 'conv-001',
        userId: 'user-001',
        chatId: 'chat-001',
        chatType: 'PRIVATE',
        lastReminderId: null,
        lastEmailThreadIds: ['thread-111', 'thread-222', 'thread-333'],
        lastFileIds: [],
        lastImageIds: [],
        pendingClarification: null,
      });

      const res = await contextResolver.resolveContext(
        'conv-001',
        'user-001',
        'chat-001',
        'soạn thư trả lời cái thứ 2 giúp anh',
      );
      expect(res.resolvedEmailId).toBe('thread-222');
      expect(res.injectedContextPrompt).toContain('thread-222');
    });

    it('should answer pending clarification and clear state', async () => {
      mockPrisma.conversationState.findUnique.mockResolvedValue({
        conversationId: 'conv-001',
        userId: 'user-001',
        chatId: 'chat-001',
        chatType: 'PRIVATE',
        lastReminderId: null,
        pendingClarification: {
          intent: 'REMINDER',
          prompt: 'Mấy giờ ạ?',
          originalText: 'nhắc anh đi siêu thị',
          missingSlots: ['dueAt'],
        },
      });

      const res = await contextResolver.resolveContext('conv-001', 'user-001', 'chat-001', '10 phút nữa nhé');
      expect(res.hasClarificationAnswer).toBe(true);
      expect(res.augmentedText).toContain('nhắc anh đi siêu thị vào lúc 10 phút nữa');
      expect(mockPrisma.conversationState.update).toHaveBeenCalled();
    });
  });

  describe('SchedulerService & Delayed Job Queueing', () => {
    let schedulerService: SchedulerService;
    const mockQueue: any = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn().mockResolvedValue({ remove: jest.fn() }),
      getJobCounts: jest.fn().mockResolvedValue({ delayed: 2 }),
    };
    const mockPrisma: any = {
      reminder: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const mockZaloClient: any = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 'msg-01' }),
    };
    const mockLogger: any = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      schedulerService = new SchedulerService(mockQueue, mockPrisma, mockZaloClient, mockLogger);
    });

    it('should create reminder in PostgreSQL and enqueue BullMQ delayed job', async () => {
      const targetDue = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.reminder.create.mockResolvedValue({
        id: 'rem-101',
        ownerId: 'owner-1',
        recipientChatId: 'chat-1',
        title: 'Gửi báo cáo dự án',
        dueAt: targetDue,
        revision: 1,
        status: 'SCHEDULED',
      });

      const res = await schedulerService.createReminder({
        ownerId: 'owner-1',
        chatId: 'chat-1',
        title: 'Gửi báo cáo dự án',
        dueAt: targetDue,
      });

      expect(res.success).toBe(true);
      expect(mockPrisma.reminder.create).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'deliver-reminder',
        { reminderId: 'rem-101', revision: 1 },
        expect.objectContaining({
          jobId: 'reminder-rem-101-1',
          delay: expect.any(Number),
        }),
      );
    });

    it('should reschedule reminder: increment revision, remove old BullMQ job, and enqueue new one', async () => {
      const oldDue = new Date(Date.now() + 5 * 60 * 1000);
      const newDue = new Date(Date.now() + 20 * 60 * 1000);

      mockPrisma.reminder.findUnique.mockResolvedValue({
        id: 'rem-101',
        ownerId: 'owner-1',
        recipientChatId: 'chat-1',
        title: 'Gửi báo cáo dự án',
        dueAt: oldDue,
        revision: 1,
        status: 'SCHEDULED',
      });

      mockPrisma.reminder.update.mockResolvedValue({
        id: 'rem-101',
        ownerId: 'owner-1',
        recipientChatId: 'chat-1',
        title: 'Gửi báo cáo dự án',
        dueAt: newDue,
        revision: 2,
        status: 'SCHEDULED',
      });

      const res = await schedulerService.rescheduleReminder({
        reminderId: 'rem-101',
        ownerId: 'owner-1',
        newDueAt: newDue,
      });

      expect(res.success).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'deliver-reminder',
        { reminderId: 'rem-101', revision: 2 },
        expect.objectContaining({
          jobId: 'reminder-rem-101-2',
        }),
      );
    });

    it('should cancel reminder and update DB status', async () => {
      mockPrisma.reminder.findUnique.mockResolvedValue({
        id: 'rem-101',
        title: 'Họp team',
        revision: 1,
        status: 'SCHEDULED',
      });

      const res = await schedulerService.cancelReminder('rem-101', 'owner-1');
      expect(res.success).toBe(true);
      expect(mockPrisma.reminder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rem-101' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('should perform self-healing reconciliation for missed reminders (server offline)', async () => {
      const pastDue = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      mockPrisma.reminder.findMany.mockResolvedValue([
        {
          id: 'missed-1',
          recipientChatId: 'chat-1',
          title: 'Họp khẩn',
          dueAt: pastDue,
          revision: 1,
          status: 'SCHEDULED',
          isLateNoticeSent: false,
        },
      ]);
      mockPrisma.reminder.update.mockResolvedValue({});

      const reconcileRes = await schedulerService.reconcileReminders();
      expect(reconcileRes.deliveredLate).toBe(1);
      expect(mockZaloClient.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.stringContaining('do hệ thống máy chủ vừa khởi động lại'),
      );
    });
  });

  describe('ReminderProcessor', () => {
    let processor: ReminderProcessor;
    const mockPrisma: any = {
      reminder: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const mockZaloClient: any = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 'zalo-msg-1' }),
    };
    const mockLogger: any = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      processor = new ReminderProcessor(mockZaloClient, mockPrisma, mockLogger);
    });

    it('should deliver scheduled reminder and update status to SENT', async () => {
      mockPrisma.reminder.findUnique.mockResolvedValue({
        id: 'rem-001',
        revision: 1,
        recipientChatId: 'chat-001',
        title: 'Uống thuốc đúng giờ',
        dueAt: new Date(),
        status: 'SCHEDULED',
      });
      mockPrisma.reminder.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.reminder.update.mockResolvedValue({});

      await processor.process({
        id: 'job-1',
        data: { reminderId: 'rem-001', revision: 1 },
      } as any);

      expect(mockZaloClient.sendMessage).toHaveBeenCalledWith(
        'chat-001',
        expect.stringContaining('Uống thuốc đúng giờ'),
      );
      expect(mockPrisma.reminder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rem-001' },
          data: expect.objectContaining({ status: 'SENT' }),
        }),
      );
    });

    it('should discard job if revision does not match (outdated rescheduled job)', async () => {
      mockPrisma.reminder.findUnique.mockResolvedValue({
        id: 'rem-001',
        revision: 2, // Current revision is 2
        recipientChatId: 'chat-001',
        title: 'Họp team',
        dueAt: new Date(),
        status: 'SCHEDULED',
      });

      await processor.process({
        id: 'job-old',
        data: { reminderId: 'rem-001', revision: 1 }, // Job has stale revision 1
      } as any);

      expect(mockZaloClient.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Reminder AI Tools', () => {
    const mockScheduler: any = {
      createReminder: jest.fn(),
      rescheduleReminder: jest.fn(),
      cancelReminder: jest.fn(),
      listActiveReminders: jest.fn(),
      getReminder: jest.fn(),
    };

    it('CreateReminderTool should invoke scheduler.createReminder', async () => {
      const tool = new CreateReminderTool(mockScheduler);
      mockScheduler.createReminder.mockResolvedValue({
        success: true,
        formattedTime: '15:30',
        reminder: { id: 'rem-xyz', title: 'Họp', dueAt: new Date() },
      });

      const res = await tool.execute(
        { title: 'Họp', dueAt: new Date().toISOString() },
        { ownerId: 'owner-1', chatId: 'chat-1' } as any,
      );

      expect(res.success).toBe(true);
      expect(res.reminderId).toBe('rem-xyz');
      expect(mockScheduler.createReminder).toHaveBeenCalled();
    });

    it('RescheduleReminderTool should extend or change time', async () => {
      const tool = new RescheduleReminderTool(mockScheduler);
      mockScheduler.rescheduleReminder.mockResolvedValue({
        success: true,
        formattedTime: '15:45',
        reminder: { id: 'rem-xyz', title: 'Họp' },
        message: 'Đã dời',
      });

      const res = await tool.execute(
        { reminderId: 'rem-xyz', extendMinutes: 15 },
        { ownerId: 'owner-1', chatId: 'chat-1' } as any,
      );

      expect(res.success).toBe(true);
      expect(mockScheduler.rescheduleReminder).toHaveBeenCalled();
    });

    it('CancelReminderTool should invoke scheduler.cancelReminder', async () => {
      const tool = new CancelReminderTool(mockScheduler);
      mockScheduler.cancelReminder.mockResolvedValue({
        success: true,
        message: 'Đã hủy lời nhắc',
      });

      const res = await tool.execute(
        { reminderId: 'rem-xyz' },
        { ownerId: 'owner-1', chatId: 'chat-1' } as any,
      );

      expect(res.success).toBe(true);
      expect(mockScheduler.cancelReminder).toHaveBeenCalledWith('rem-xyz', 'owner-1');
    });

    it('ListRemindersTool should return formatted active reminders', async () => {
      const tool = new ListRemindersTool(mockScheduler);
      mockScheduler.listActiveReminders.mockResolvedValue([
        { id: 'rem-1', title: 'Việc 1', dueAt: new Date() },
      ]);

      const res = await tool.execute({}, { ownerId: 'owner-1', chatId: 'chat-1' } as any);
      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
    });
  });
});
