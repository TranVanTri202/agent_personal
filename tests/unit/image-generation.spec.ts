import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ImageGenerationService } from '../../src/modules/image-generation/image-generation.service';
import { ImageCapabilityService } from '../../src/modules/image-generation/image-capability.service';
import { OpenRouterImageClient } from '../../src/modules/image-generation/openrouter-image.client';
import { ImageContextService } from '../../src/modules/image-generation/image-context.service';
import { GenerateImageTool, EditImageTool } from '../../src/modules/tools/impl/image.tools';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';
import { TaskProgressService } from '../../src/modules/tasks/task-progress.service';

describe('OpenRouter Image Generation & Editing Module', () => {
  let imageGenService: ImageGenerationService;
  let capabilityService: ImageCapabilityService;
  let imageClient: OpenRouterImageClient;
  let imageContextService: ImageContextService;
  let generateImageTool: GenerateImageTool;
  let editImageTool: EditImageTool;
  let taskProgressService: TaskProgressService;

  const mockOwnerId = 'owner-uuid-001';
  const mockChatId = 'chat-owner-001';
  const mockTaskId = 'task-uuid-001';

  // 1x1 transparent PNG buffer
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  const mockStorageService = {
    saveFile: jest.fn().mockResolvedValue({
      id: 'stored-file-123',
      objectKey: 'outputs/images/owner-uuid-001/test.png',
      mimeType: 'image/png',
      originalName: 'test.png',
      sizeBytes: BigInt(samplePngBuffer.length),
    }),
    getDownloadLink: jest.fn().mockResolvedValue({
      url: 'https://r2.storage.example.com/outputs/images/owner-uuid-001/test.png?token=signed',
      localPath: '/data/outputs/images/test.png',
    }),
    getFileBuffer: jest.fn().mockResolvedValue({
      buffer: samplePngBuffer,
      mimeType: 'image/png',
      originalName: 'original.png',
      file: {
        id: 'stored-file-original',
        ownerId: mockOwnerId,
        objectKey: 'user-inputs/owner-uuid-001/input.png',
      },
    }),
  };

  const mockPrismaService = {
    generatedImage: {
      create: jest.fn().mockResolvedValue({
        id: 'gen-image-123',
        ownerId: mockOwnerId,
        conversationId: 'conv-001',
        taskId: mockTaskId,
        fileId: 'stored-file-123',
        prompt: 'A cute cat coding',
        modelId: 'qwen/qwen-image-2.1-turbo',
        actionType: 'generate',
        costUsd: 0.02,
        status: 'SUCCESS',
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    storedFile: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  const mockAuthService = {
    isOwner: jest.fn((id: string) => Promise.resolve(id === mockOwnerId)),
  };

  const mockZaloApiClient = {
    sendPhoto: jest.fn().mockResolvedValue({ ok: true }),
    sendMessage: jest.fn().mockResolvedValue({ ok: true }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'OPENROUTER_IMAGE_MODEL') return 'qwen/qwen-image-2.1-turbo';
      if (key === 'OPENROUTER_IMAGE_EDIT_MODEL') return 'qwen/qwen-image-2.1-turbo';
      if (key === 'OPENROUTER_API_KEY') return 'sk-or-v1-mock-key';
      if (key === 'OPENROUTER_BASE_URL') return 'https://openrouter.ai/api/v1';
      return null;
    }),
  };

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerationService,
        ImageCapabilityService,
        OpenRouterImageClient,
        ImageContextService,
        GenerateImageTool,
        EditImageTool,
        TaskProgressService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ZaloApiClient, useValue: mockZaloApiClient },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    imageGenService = module.get<ImageGenerationService>(ImageGenerationService);
    capabilityService = module.get<ImageCapabilityService>(ImageCapabilityService);
    imageClient = module.get<OpenRouterImageClient>(OpenRouterImageClient);
    imageContextService = module.get<ImageContextService>(ImageContextService);
    generateImageTool = module.get<GenerateImageTool>(GenerateImageTool);
    editImageTool = module.get<EditImageTool>(EditImageTool);
    taskProgressService = module.get<TaskProgressService>(TaskProgressService);
  });

  describe('1. Model Capabilities & Parameter Sanitization', () => {
    it('should validate supported aspect ratios against model capabilities', async () => {
      // Mock getImageModels response
      jest.spyOn(capabilityService, 'getImageModels').mockResolvedValue([
        {
          id: 'qwen/qwen-image-2.1-turbo',
          name: 'Qwen Image 2.1 Turbo',
          supportedParameters: {
            aspect_ratio: { values: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
            resolution: { values: ['1024x1024', '1024x576'] },
            n: { min: 1, max: 4 },
            input_references: { min: 0, max: 4 },
          },
          supportsInputReferences: true,
          maxInputReferences: 4,
        },
      ]);

      const result = await capabilityService.validateAndSanitizeParams('qwen/qwen-image-2.1-turbo', {
        aspectRatio: '16:9',
        resolution: '1024x576',
        count: 2,
      });

      expect(result.sanitized.aspect_ratio).toBe('16:9');
      expect(result.sanitized.resolution).toBe('1024x576');
      expect(result.sanitized.n).toBe(2);
      expect(result.warning).toBeUndefined();
    });

    it('should reject reference images if model does not support input_references', async () => {
      jest.spyOn(capabilityService, 'getImageModels').mockResolvedValue([
        {
          id: 'unsupported-edit-model',
          name: 'Unsupported Edit Model',
          supportedParameters: {},
          supportsInputReferences: false,
          maxInputReferences: 0,
        },
      ]);

      await expect(
        capabilityService.validateAndSanitizeParams('unsupported-edit-model', {
          hasReference: true,
        }),
      ).rejects.toThrow(/không hỗ trợ chỉnh sửa ảnh bằng ảnh mẫu/);
    });
  });

  describe('2. Text-to-Image Generation (generate_image)', () => {
    it('should generate image and deliver photo to Zalo via sendPhoto', async () => {
      jest.spyOn(imageClient, 'callImageApi').mockResolvedValue({
        data: [
          {
            b64_json: samplePngBuffer.toString('base64'),
            media_type: 'image/png',
          },
        ],
        costUsd: 0.025,
      });

      const res = await generateImageTool.execute(
        {
          prompt: 'A lovely chibi cat drinking coffee',
          aspectRatio: '1:1',
          style: 'chibi',
        },
        {
          ownerId: mockOwnerId,
          chatId: mockChatId,
          taskId: mockTaskId,
          conversationId: 'conv-001',
        },
      );

      expect(res.success).toBe(true);
      expect(res.modelId).toBe('qwen/qwen-image-2.1-turbo');
      expect(res.actionType).toBe('generate');
      expect(res.costUsd).toBe(0.025);
      expect(mockStorageService.saveFile).toHaveBeenCalled();
      expect(mockZaloApiClient.sendPhoto).toHaveBeenCalledWith(
        mockChatId,
        expect.stringContaining('r2.storage.example.com'),
        expect.stringContaining('qwen/qwen-image-2.1-turbo'),
      );
    });

    it('should reject unauthorized non-owner callers', async () => {
      await expect(
        generateImageTool.execute(
          { prompt: 'Malicious image request' },
          {
            ownerId: 'stranger-user-id',
            chatId: 'group-chat-999',
            taskId: 'task-999',
          },
        ),
      ).rejects.toThrow(/Chỉ chủ sở hữu \(Owner\) mới được cấp quyền/);
    });
  });

  describe('3. Image-to-Image Editing (edit_image)', () => {
    it('should resolve recent input image and call API with input_references', async () => {
      // Setup image client mock
      const callSpy = jest.spyOn(imageClient, 'callImageApi').mockResolvedValue({
        data: [
          {
            b64_json: samplePngBuffer.toString('base64'),
            media_type: 'image/png',
          },
        ],
        costUsd: 0.03,
      });

      // Mock axios.get for downloading user image
      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: samplePngBuffer,
        headers: { 'content-type': 'image/png' },
      });

      // User sent an image earlier into the chat
      await imageContextService.recordIncomingUserImage({
        chatId: mockChatId,
        ownerId: mockOwnerId,
        conversationId: 'conv-001',
        imageUrl: 'https://zalo-cdn.example.com/user-photo.jpg',
      });

      const res = await editImageTool.execute(
        {
          prompt: 'Đổi nền thành màu trắng, phong cách studio',
        },
        {
          ownerId: mockOwnerId,
          chatId: mockChatId,
          taskId: mockTaskId,
          conversationId: 'conv-001',
        },
      );

      expect(res.success).toBe(true);
      expect(res.actionType).toBe('edit');
      expect(callSpy).toHaveBeenCalled();
      const payload = callSpy.mock.calls[0][0];
      expect(payload.input_references).toBeDefined();
      expect(payload.input_references?.length).toBe(1);
      expect(payload.input_references?.[0].image_url.url).toContain('data:image/');
      expect(mockZaloApiClient.sendPhoto).toHaveBeenCalled();
    });

    it('should throw clear error when no reference image is found', async () => {
      await expect(
        editImageTool.execute(
          { prompt: 'Sửa màu nền' },
          {
            ownerId: mockOwnerId,
            chatId: 'fresh-chat-without-images',
            taskId: mockTaskId,
          },
        ),
      ).rejects.toThrow(/Không tìm thấy ảnh tham chiếu để chỉnh sửa/);
    });
  });

  describe('4. Error Handling and Zalo Delivery Fallbacks', () => {
    it('should deliver download link message if sendPhoto fails', async () => {
      jest.spyOn(imageClient, 'callImageApi').mockResolvedValue({
        data: [{ b64_json: samplePngBuffer.toString('base64'), media_type: 'image/png' }],
      });
      mockZaloApiClient.sendPhoto.mockRejectedValueOnce(new Error('Zalo OpenAPI CDN timeout'));

      const res = await generateImageTool.execute(
        { prompt: 'Test banner' },
        { ownerId: mockOwnerId, chatId: mockChatId },
      );

      expect(res.success).toBe(true);
      // Fallback message sent to user
      expect(mockZaloApiClient.sendMessage).toHaveBeenCalledWith(
        mockChatId,
        expect.stringContaining('gửi trực tiếp qua Zalo gặp lỗi'),
      );
    });

    it('should format helpful error on OpenRouter 402 Insufficient credits', () => {
      const axiosError: any = new Error('Request failed with status code 402');
      axiosError.isAxiosError = true;
      axiosError.response = { status: 402, data: { error: { message: 'Insufficient credits' } } };

      expect(() => {
        (imageClient as any).handleApiError(axiosError, 'test-model');
      }).toThrow(/không đủ số dư \(Insufficient credits\)/);
    });
  });

  describe('5. Task Progress & ACK for Image Generation', () => {
    it('should detect image creation requests as long-running tasks', () => {
      expect(taskProgressService.isLongRunningTask('tạo ảnh con mèo chibi')).toBe(true);
      expect(taskProgressService.isLongRunningTask('vẽ cho tôi cái banner')).toBe(true);
      expect(taskProgressService.isLongRunningTask('chỉnh sửa ảnh này giúp tôi')).toBe(true);
    });

    it('should generate courteous, natural ACK message for image tasks', () => {
      const ack = taskProgressService.generateAckMessage('vẽ cho tôi con mèo chibi phong cách đáng yêu');
      expect(ack).toContain('Dạ vâng ạ, em nhận yêu cầu tạo/chỉnh sửa ảnh rồi! Em bắt đầu xử lý nhé 🎨');
    });

    it('should notify tool_started and tool_completed for generate_image', async () => {
      await taskProgressService.notifyToolStarted(mockTaskId, mockChatId, 'generate_image');
      expect(mockZaloApiClient.sendMessage).toHaveBeenCalledWith(
        mockChatId,
        expect.stringContaining('em bắt đầu vẽ đây!'),
      );

      await taskProgressService.notifyToolCompleted(mockTaskId, mockChatId, 'generate_image', { success: true });
      expect(mockZaloApiClient.sendMessage).toHaveBeenCalledWith(
        mockChatId,
        expect.stringContaining('Em đã hoàn thành ảnh rồi ạ!'),
      );
    });
  });
});
