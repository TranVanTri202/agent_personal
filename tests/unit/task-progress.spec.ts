import { TaskProgressService } from '../../src/modules/tasks/task-progress.service';
import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';

describe('TaskProgressService', () => {
  let progressService: TaskProgressService;
  let mockZaloClient: any;
  let mockLogger: any;

  beforeEach(() => {
    mockZaloClient = {
      sendMessage: jest.fn().mockResolvedValue([{ ok: true }]),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    progressService = new TaskProgressService(
      mockZaloClient as unknown as ZaloApiClient,
      mockLogger as unknown as AppLoggerService,
    );
  });

  afterEach(() => {
    progressService.clearAllWatchdogs();
  });

  it('should identify long running tasks vs quick chats accurately', () => {
    expect(progressService.isLongRunningTask('tạo file excel kế hoạch 2025')).toBe(true);
    expect(progressService.isLongRunningTask('đọc 10 email gần nhất từ gmail')).toBe(true);
    expect(progressService.isLongRunningTask('lập kế hoạch công việc tuần này')).toBe(true);
    expect(progressService.isLongRunningTask('viết code python giải bài toán')).toBe(true);

    expect(progressService.isLongRunningTask('Xin chào bạn nhé')).toBe(false);
    expect(progressService.isLongRunningTask('Hôm nay thời tiết thế nào?')).toBe(false);
    expect(progressService.isLongRunningTask('/whoami')).toBe(false);
  });

  it('should generate appropriate early ACK messages based on task nature', () => {
    const excelAck = progressService.generateAckMessage('Tạo giúp tôi file excel bảng lương');
    expect(excelAck).toContain('Dạ, em nhận việc rồi ạ');
    expect(excelAck).toContain('Excel');

    const mailAck = progressService.generateAckMessage('Kiểm tra hộp thư gmail của tôi');
    expect(mailAck).toContain('Gmail');

    const generalAck = progressService.generateAckMessage('Phân tích thị trường công nghệ');
    expect(generalAck).toContain('Dạ, em nhận việc rồi ạ');
  });

  it('should send early ACK through Zalo client', async () => {
    await progressService.sendEarlyAck('chat-100', 'Tạo file excel chi phí');
    expect(mockZaloClient.sendMessage).toHaveBeenCalledWith('chat-100', expect.stringContaining('Excel'));
  });

  it('should notify tool started and completed', async () => {
    await progressService.notifyToolStarted('t-1', 'chat-100', 'create_excel', { filename: 'bao_cao.xlsx' });
    expect(mockZaloClient.sendMessage).toHaveBeenCalledWith('chat-100', expect.stringContaining('bao_cao.xlsx'));

    await progressService.notifyToolCompleted('t-1', 'chat-100', 'create_excel', { filename: 'bao_cao.xlsx' });
    expect(mockZaloClient.sendMessage).toHaveBeenCalledWith('chat-100', expect.stringContaining('đã tạo xong nội dung'));
  });

  it('should manage watchdog timer cleanly', () => {
    progressService.startWatchdog('t-99', 'chat-100', 50000);
    expect((progressService as any).watchdogs.has('t-99')).toBe(true);

    progressService.stopWatchdog('t-99');
    expect((progressService as any).watchdogs.has('t-99')).toBe(false);
  });
});
