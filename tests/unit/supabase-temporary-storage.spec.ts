import { TemporaryStorageService } from '../../src/modules/storage/temporary-storage.service';
import { SupabaseStorageClient } from '../../src/modules/storage/supabase-storage.client';
import { LocalStorageProvider } from '../../src/modules/storage/local-storage.provider';
import { TemporaryFileCleanupProcessor } from '../../src/modules/storage/temporary-file-cleanup.processor';
import { TemporaryFileSweeperService } from '../../src/modules/storage/temporary-file-sweeper.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import {
  TEMP_FILE_TTL_MS,
  FileExpiredError,
  FileAccessDeniedError,
} from '../../src/modules/storage/temporary-storage.types';

describe('Supabase Temporary Storage Subsystem (24-Hour TTL)', () => {
  let temporaryStorageService: TemporaryStorageService;
  let supabaseClient: SupabaseStorageClient;
  let localProvider: LocalStorageProvider;
  let storageService: StorageService;
  let cleanupProcessor: TemporaryFileCleanupProcessor;
  let sweeperService: TemporaryFileSweeperService;

  const mockQueue: any = {
    add: jest.fn().mockResolvedValue({ id: 'job-temp-1' }),
  };

  const mockPrisma: any = {
    storedFile: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockLogger: any = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockSupabaseClientInner: any = {
    storage: {
      from: jest.fn().mockReturnValue({
        upload: jest.fn().mockResolvedValue({ data: { path: 'temp/owner1/test.png' }, error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://supabase.example.co/signed-url' }, error: null }),
        remove: jest.fn().mockResolvedValue({ data: [], error: null }),
        download: jest.fn().mockResolvedValue({ data: { arrayBuffer: () => Promise.resolve(Buffer.from('test')) }, error: null }),
      }),
      listBuckets: jest.fn().mockResolvedValue({ data: [{ name: 'agent-temp', public: false }], error: null }),
      getBucket: jest.fn().mockResolvedValue({ data: { name: 'agent-temp', public: false }, error: null }),
      createBucket: jest.fn().mockResolvedValue({ data: { name: 'agent-temp' }, error: null }),
    },
  };

  const mockConfigService: any = {
    get: jest.fn((key: string) => {
      if (key === 'SUPABASE_URL') return 'https://test-ref.supabase.co';
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'secret-service-role-key-test-value';
      if (key === 'SUPABASE_STORAGE_BUCKET') return 'agent-temp';
      if (key === 'STORAGE_PROVIDER') return 'supabase';
      if (key === 'LOCAL_STORAGE_ROOT') return './data';
      return null;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    supabaseClient = new SupabaseStorageClient(mockConfigService, mockLogger);
    (supabaseClient as any).client = mockSupabaseClientInner;

    localProvider = new LocalStorageProvider(mockConfigService);
    jest.spyOn(localProvider, 'put').mockResolvedValue({
      objectKey: 'local/path',
      sizeBytes: 100,
      mimeType: 'text/plain',
      checksum: 'abc',
      provider: 'LOCAL',
    });
    jest.spyOn(localProvider, 'get').mockResolvedValue(Buffer.from('hello local'));
    jest.spyOn(localProvider, 'delete').mockResolvedValue();

    temporaryStorageService = new TemporaryStorageService(
      mockQueue,
      mockPrisma,
      supabaseClient,
      localProvider,
      mockLogger,
    );

    const mockR2Provider: any = { isConfigured: () => false };
    storageService = new StorageService(
      mockConfigService,
      mockPrisma,
      localProvider,
      mockR2Provider,
      supabaseClient,
      temporaryStorageService,
      mockLogger,
    );

    cleanupProcessor = new TemporaryFileCleanupProcessor(temporaryStorageService, mockLogger);
    sweeperService = new TemporaryFileSweeperService(temporaryStorageService, mockLogger);
  });

  describe('1. Upload Temporary File & 24h Expiry Calculation', () => {
    it('Case 1: Upload thành công -> có object + record ACTIVE + expiresAt = uploadedAt + 24h', async () => {
      const buffer = Buffer.from('excel test data');
      const filename = 'report.xlsx';
      const ownerId = 'user_123';

      mockPrisma.storedFile.create.mockImplementation(({ data }: any) => ({
        ...data,
        id: 'file-uuid-001',
      }));

      const before = Date.now();
      const res = await temporaryStorageService.uploadTemporaryFile({
        file: buffer,
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ownerId,
      });
      const after = Date.now();

      expect(res.fileId).toBe('file-uuid-001');
      expect(res.bucket).toBe('agent-temp');
      expect(res.objectPath).toMatch(/^temp\/user_123\/\d{4}\/\d{2}\/[a-f0-9-]+\.xlsx$/);

      // Verify exact 24 hours
      const diff = res.expiresAt.getTime() - res.uploadedAt.getTime();
      expect(diff).toBe(TEMP_FILE_TTL_MS);
      expect(res.uploadedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(res.uploadedAt.getTime()).toBeLessThanOrEqual(after);

      // Verify BullMQ delayed job enqueued with ~24h delay
      expect(mockQueue.add).toHaveBeenCalledWith(
        'delete-temporary-file',
        { fileId: 'file-uuid-001' },
        expect.objectContaining({
          jobId: 'temp-delete-file-uuid-001',
          delay: expect.any(Number),
          attempts: 5,
        }),
      );
    });

    it('Case 2: Upload thất bại -> không trả URL, không để record ACTIVE sai', async () => {
      jest.spyOn(supabaseClient, 'uploadObject').mockRejectedValueOnce(new Error('Supabase 503 Service Unavailable'));

      await expect(
        temporaryStorageService.uploadTemporaryFile({
          file: Buffer.from('data'),
          filename: 'test.png',
          mimeType: 'image/png',
          ownerId: 'owner_1',
        }),
      ).rejects.toThrow('Supabase 503 Service Unavailable');

      expect(mockPrisma.storedFile.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('Case 3: Storage upload thành công nhưng DB ghi lỗi -> bù trừ xóa object khỏi Storage', async () => {
      const removeSpy = jest.spyOn(supabaseClient, 'removeObjects');
      mockPrisma.storedFile.create.mockRejectedValueOnce(new Error('Postgres connection pool exhausted'));

      await expect(
        temporaryStorageService.uploadTemporaryFile({
          file: Buffer.from('data'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          ownerId: 'owner_1',
        }),
      ).rejects.toThrow('Database error saving temporary file metadata');

      // Compensation verification
      expect(removeSpy).toHaveBeenCalledWith([expect.stringMatching(/^temp\/owner_1/)] );
    });
  });

  describe('2. Deletion Timing & Idempotency (24h Rules)', () => {
    it('Case 4: Sau 23h59m -> KHÔNG xóa file', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 1000); // Expires in 1 minute (23h59m elapsed)

      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-001',
        objectKey: 'temp/user/test.pdf',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });

      const removeSpy = jest.spyOn(supabaseClient, 'removeObjects');

      await temporaryStorageService.deleteExpiredFile('file-001');

      // Must NOT remove from storage
      expect(removeSpy).not.toHaveBeenCalled();
      expect(mockPrisma.storedFile.update).not.toHaveBeenCalled();
    });

    it('Case 5: Đúng mốc 24h / đến hạn -> delete Storage + mark DELETED', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() - 1000); // 1 second ago (expired)

      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-001',
        objectKey: 'temp/user/test.pdf',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });
      mockPrisma.storedFile.update.mockResolvedValue({});

      const removeSpy = jest.spyOn(supabaseClient, 'removeObjects');

      await temporaryStorageService.deleteExpiredFile('file-001');

      // Must remove from storage
      expect(removeSpy).toHaveBeenCalledWith(['temp/user/test.pdf']);
      // Must mark DELETED in DB
      expect(mockPrisma.storedFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'file-001' },
          data: expect.objectContaining({ status: 'DELETED' }),
        }),
      );
    });

    it('Case 6: Xóa lỗi tạm thời -> retry, không mất metadata, status DELETE_FAILED', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() - 1000);

      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-001',
        objectKey: 'temp/user/test.pdf',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });
      mockPrisma.storedFile.update.mockResolvedValue({});

      jest.spyOn(supabaseClient, 'removeObjects').mockRejectedValueOnce(new Error('Network timeout'));

      await expect(temporaryStorageService.deleteExpiredFile('file-001')).rejects.toThrow('Network timeout');

      expect(mockPrisma.storedFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'file-001' },
          data: expect.objectContaining({ status: 'DELETE_FAILED', lastErrorCode: 'Network timeout' }),
        }),
      );
    });

    it('Case 9: Hai worker nhận cùng file -> xử lý an toàn (idempotent)', async () => {
      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-001',
        objectKey: 'temp/user/test.pdf',
        expiresAt: new Date(Date.now() - 5000),
        status: 'DELETED', // Already deleted by worker 1
        provider: 'SUPABASE',
      });

      const removeSpy = jest.spyOn(supabaseClient, 'removeObjects');

      // Worker 2 runs
      await temporaryStorageService.deleteExpiredFile('file-001');

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Layer B: Recovery Sweeper & Worker Restart', () => {
    it('Case 7 & 8: Sweeper tìm thấy file quá hạn (do Redis mất job hoặc restart) và xử lý', async () => {
      const past = new Date(Date.now() - 10 * 60 * 1000);
      mockPrisma.storedFile.findMany.mockResolvedValue([
        {
          id: 'swept-1',
          objectKey: 'temp/user/swept1.png',
          expiresAt: past,
          status: 'ACTIVE',
          provider: 'SUPABASE',
        },
        {
          id: 'swept-2',
          objectKey: 'temp/user/swept2.xlsx',
          expiresAt: past,
          status: 'DELETE_FAILED',
          provider: 'SUPABASE',
        },
      ]);
      mockPrisma.storedFile.findUnique.mockImplementation(({ where }: any) => ({
        id: where.id,
        objectKey: `temp/user/${where.id}`,
        expiresAt: past,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      }));
      mockPrisma.storedFile.update.mockResolvedValue({});

      const sweepRes = await temporaryStorageService.sweepExpiredFiles();

      expect(sweepRes.sweptCount).toBe(2);
      expect(mockPrisma.storedFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE', 'DELETE_FAILED'] },
          }),
        }),
      );
    });

    it('CleanupProcessor process job invoking deleteExpiredFile', async () => {
      const spy = jest.spyOn(temporaryStorageService, 'deleteExpiredFile').mockResolvedValueOnce();

      const job: any = { id: 'job-999', data: { fileId: 'file-abc' } };
      const res = await cleanupProcessor.process(job);

      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalledWith('file-abc');
    });
  });

  describe('4. URL Generation & Access Control', () => {
    it('Case 10: File quá hạn -> ném lỗi FileExpiredError, không cấp signed URL mới', async () => {
      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-expired',
        objectKey: 'temp/user/doc.pdf',
        expiresAt: new Date(Date.now() - 5000), // Expired
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });

      await expect(
        temporaryStorageService.createTemporaryDownloadUrl('file-expired'),
      ).rejects.toThrow(FileExpiredError);
    });

    it('Case 11: Signed URL có TTL không vượt thời gian sống còn lại của file', async () => {
      const remainingSeconds = 3600; // 1 hour left
      const expiresAt = new Date(Date.now() + remainingSeconds * 1000);

      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-live',
        objectKey: 'temp/user/doc.pdf',
        originalName: 'doc.pdf',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });

      const signedUrlSpy = jest.spyOn(supabaseClient, 'createSignedUrl');

      await temporaryStorageService.createTemporaryDownloadUrl('file-live');

      expect(signedUrlSpy).toHaveBeenCalledWith(
        'temp/user/doc.pdf',
        expect.any(Number),
        'doc.pdf',
      );
      const callTtl = signedUrlSpy.mock.calls[0][1];
      expect(callTtl).toBeLessThanOrEqual(remainingSeconds);
      expect(callTtl).toBeGreaterThan(remainingSeconds - 5);
    });

    it('Case 12 & 13: User lạ không thể lấy link file của Owner -> ném FileAccessDeniedError', async () => {
      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-private',
        ownerId: 'owner-real-uuid',
        objectKey: 'temp/owner-real-uuid/secret.pdf',
        expiresAt: new Date(Date.now() + 100000),
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });

      await expect(
        temporaryStorageService.createTemporaryDownloadUrl('file-private', {
          userId: 'stranger-uuid',
          isOwner: false,
        }),
      ).rejects.toThrow(FileAccessDeniedError);
    });
  });

  describe('5. High-level StorageService Facade', () => {
    it('Case 15: StorageService.getDownloadLink trả thông báo thời hạn 24h rõ ràng', async () => {
      const expiresAt = new Date(Date.now() + 20 * 3600 * 1000); // 20 hours left
      mockPrisma.storedFile.findFirst.mockResolvedValue({
        id: 'file-doc-1',
        objectKey: 'temp/owner/report.xlsx',
        originalName: 'report.xlsx',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });
      mockPrisma.storedFile.findUnique.mockResolvedValue({
        id: 'file-doc-1',
        objectKey: 'temp/owner/report.xlsx',
        originalName: 'report.xlsx',
        expiresAt,
        status: 'ACTIVE',
        provider: 'SUPABASE',
      });

      const link = await storageService.getDownloadLink('file-doc-1');

      expect(link.url).toBe('https://supabase.example.co/signed-url');
      expect(link.message).toContain('Link tải có hiệu lực trong');
      expect(link.message).toContain('20 giờ');
    });

    it('StorageService.getDownloadLink báo rõ khi file đã hết hạn 24h', async () => {
      mockPrisma.storedFile.findFirst.mockResolvedValue({
        id: 'file-doc-old',
        objectKey: 'temp/owner/old.xlsx',
        originalName: 'old.xlsx',
        expiresAt: new Date(Date.now() - 5000),
        status: 'DELETED',
        provider: 'SUPABASE',
      });

      const link = await storageService.getDownloadLink('file-doc-old');
      expect(link.isExpired).toBe(true);
      expect(link.message).toContain('đã hết hạn lưu trữ tạm (24 giờ)');
    });
  });
});
