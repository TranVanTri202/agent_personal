import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import configuration from '../../src/config/configuration';
import { PrismaModule } from '../../src/modules/prisma/prisma.module';
import { CommonModule } from '../../src/common/common.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { ConversationsModule } from '../../src/modules/conversations/conversations.module';
import { StorageModule } from '../../src/modules/storage/storage.module';
import { FilesModule } from '../../src/modules/files/files.module';
import { ApprovalsModule } from '../../src/modules/approvals/approvals.module';
import { ToolsModule } from '../../src/modules/tools/tools.module';
import { LLMModule } from '../../src/modules/llm/llm.module';
import { GmailModule } from '../../src/modules/gmail/gmail.module';
import { SchedulerModule } from '../../src/modules/scheduler/scheduler.module';
import { TasksModule } from '../../src/modules/tasks/tasks.module';
import { AgentModule } from '../../src/modules/agent/agent.module';
import { ZaloModule } from '../../src/modules/zalo/zalo.module';
import { StickersModule } from '../../src/modules/stickers/stickers.module';
import { ImageGenerationModule } from '../../src/modules/image-generation/image-generation.module';
import { ConversationIntelligenceModule } from '../../src/modules/conversation-intelligence/conversation-intelligence.module';
import { BullModule } from '@nestjs/bullmq';
import { AgentService } from '../../src/modules/agent/agent.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { ZaloApiClient } from '../../src/modules/zalo/zalo-api.client';
import { OpenRouterClientProvider } from '../../src/modules/llm/openrouter/openrouter.client';
import { NormalizedIncomingMessage } from '../../src/modules/zalo/zalo-event.normalizer';

describe('Context Intelligence Regression Tests (PROMPT_BE_FIX_ZALO_AGENT_CONTEXT_INTELLIGENCE)', () => {
  let moduleRef: TestingModule;
  let agentService: AgentService;
  let authService: AuthService;
  let prisma: PrismaService;
  let zaloClient: ZaloApiClient;

  const mockSentMessages: Array<{ chatId: string; text: string }> = [];
  const mockSentPhotos: Array<{ chatId: string; photoUrl: string; caption?: string }> = [];

  const TEST_OWNER_ZALO_ID = 'regression-owner-zalo-id';
  const TEST_CHAT_ID = 'regression-chat-id';
  const TEST_GROUP_CHAT_ID = 'regression-group-chat-id';

  beforeAll(async () => {
    process.env.BOT_ACCESS_MODE = 'private';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        BullModule.forRoot({
          connection: { host: 'localhost', port: 6380 },
        }),
        PrismaModule,
        CommonModule,
        AuthModule,
        ConversationsModule,
        StorageModule,
        FilesModule,
        ApprovalsModule,
        ToolsModule,
        LLMModule,
        GmailModule,
        SchedulerModule,
        TasksModule,
        AgentModule,
        ZaloModule,
        StickersModule,
        ImageGenerationModule,
        ConversationIntelligenceModule,
      ],
    })
      .overrideProvider(ZaloApiClient)
      .useValue({
        hasToken: () => true,
        sendMessage: jest.fn(async (chatId: string, text: string) => {
          mockSentMessages.push({ chatId, text });
          return [{ ok: true }];
        }),
        sendPhoto: jest.fn(async (chatId: string, photoUrl: string, caption?: string) => {
          mockSentPhotos.push({ chatId, photoUrl, caption });
          return { ok: true, result: { message_id: 'photo-msg-123' } };
        }),
        sendFileLink: jest.fn(async (chatId: string, url: string, name: string) => {
          mockSentMessages.push({ chatId, text: `[FILE: ${name}] ${url}` });
          return [{ ok: true }];
        }),
        sendSticker: jest.fn(async () => ({ ok: true })),
        sendChatAction: jest.fn(async () => ({ ok: true })),
        getWebhookInfo: jest.fn(async () => ({ ok: true, result: {} })),
      })
      .overrideProvider(OpenRouterClientProvider)
      .useValue({
        isConfigured: () => false,
        getClient: () => null,
      })
      .compile();

    await moduleRef.init();

    agentService = moduleRef.get(AgentService);
    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    zaloClient = moduleRef.get(ZaloApiClient);

    // Mock axios.get for image downloading
    const samplePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockImplementation(((async (url: any) => {
      if (typeof url === 'string' && (url.includes('screenshot') || url.includes('image'))) {
        return {
          data: samplePng,
          headers: { 'content-type': 'image/jpeg' },
          status: 200,
        };
      }
      return { data: { data: [] }, status: 200 };
    }) as any));

    // Clean up previous test runs if any
    await prisma.inboundEvent.deleteMany({
      where: {
        externalEventId: { startsWith: 'reg-' },
      },
    });

    // Ensure TEST_OWNER_ZALO_ID has OWNER role
    await prisma.user.upsert({
      where: { zaloUserId: TEST_OWNER_ZALO_ID },
      update: { role: 'OWNER' },
      create: {
        zaloUserId: TEST_OWNER_ZALO_ID,
        displayName: 'Regression Test Owner',
        role: 'OWNER',
      },
    });
  });

  afterAll(async () => {
    await prisma.inboundEvent.deleteMany({
      where: {
        externalEventId: { startsWith: 'reg-' },
      },
    });
    await prisma.user.deleteMany({
      where: { zaloUserId: TEST_OWNER_ZALO_ID },
    });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    mockSentMessages.length = 0;
    mockSentPhotos.length = 0;
    jest.clearAllMocks();
  });

  const getMsgId = (prefix: string) => `reg-${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  it('1. Regression Bug Reproduction: User sends image -> "Ảnh đó có thông tin gì? Gửi lại coi."', async () => {
    // Step 1: User sends an image to Zalo
    const fakeImageUrl = 'https://example.com/test-screenshot.jpg';
    const imageMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: getMsgId('img-001'),
      senderId: TEST_OWNER_ZALO_ID,
      chatId: TEST_CHAT_ID,
      chatType: 'PRIVATE',
      type: 'IMAGE',
      imageUrl: fakeImageUrl,
      attachments: [{ type: 'IMAGE', sourceUrl: fakeImageUrl }],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(imageMsg);

    // Step 2: User asks: "Ảnh đó có thông tin gì? Gửi lại coi."
    const queryMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: getMsgId('query-002'),
      senderId: TEST_OWNER_ZALO_ID,
      chatId: TEST_CHAT_ID,
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: 'Ảnh đó có thông tin gì? Gửi lại coi.',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(queryMsg);

    // Verify 1: sendPhoto MUST be called to resend the photo (not ignored!)
    expect(zaloClient.sendPhoto).toHaveBeenCalled();

    // Verify 2: Bot must NOT hallucinate "mèo chibi" if user uploaded a screenshot!
    const replyTexts = mockSentMessages.map((m) => m.text).join(' ');
    expect(replyTexts).not.toContain('mèo chibi trắng đang nằm ngủ');
  });

  it('2. Command /clear should reset conversation context without touching long-term data', async () => {
    // Send a message first
    await agentService.handleIncomingMessage({
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: getMsgId('msg-pre-clear'),
      senderId: TEST_OWNER_ZALO_ID,
      chatId: TEST_CHAT_ID,
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: 'Tôi tên là TriTV và làm việc ở TP.HCM',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    });

    mockSentMessages.length = 0;

    // Send /clear command
    await agentService.handleIncomingMessage({
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: getMsgId('cmd-clear'),
      senderId: TEST_OWNER_ZALO_ID,
      chatId: TEST_CHAT_ID,
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: '/clear',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    });

    // Check confirmation message
    const clearConfirm = mockSentMessages.find((m) => m.text.includes('xóa ngữ cảnh'));
    expect(clearConfirm).toBeDefined();
    expect(clearConfirm?.text).toContain('bắt đầu lại từ đầu nhé');
  });

  it('3. Security Isolation: In a GROUP chat, user cannot access owner private data or private files', async () => {
    const groupStrangerMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: getMsgId('group-msg-001'),
      senderId: 'stranger-group-user-999',
      chatId: TEST_GROUP_CHAT_ID,
      chatType: 'GROUP',
      type: 'TEXT',
      text: 'Gửi lại email gần nhất của owner',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(groupStrangerMsg);

    const groupReplies = mockSentMessages.filter((m) => m.chatId === TEST_GROUP_CHAT_ID);
    const text = groupReplies.map((r) => r.text).join(' ');
    // Must NOT leak private owner email
    expect(text).not.toContain('subject');
  });
});
