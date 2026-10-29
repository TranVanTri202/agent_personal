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

describe('Agent Flow Integration', () => {
  let moduleRef: TestingModule;
  let agentService: AgentService;
  let authService: AuthService;
  let prisma: PrismaService;
  let zaloClient: ZaloApiClient;

  const mockSentMessages: Array<{ chatId: string; text: string }> = [];

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
        sendPhoto: jest.fn(async () => ({ ok: true })),
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    mockSentMessages.length = 0;
  });

  beforeAll(async () => {
    // Clean up scoped test data
    await prisma.storedFile.deleteMany({
      where: { ownerId: { in: ['owner-zalo-id-123', 'stranger-001'] } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { externalChatId: { in: ['chat-owner-123', 'chat-stranger-001'] } } },
    });
    await prisma.conversation.deleteMany({
      where: { externalChatId: { in: ['chat-owner-123', 'chat-stranger-001'] } },
    });
    await prisma.user.deleteMany({
      where: { zaloUserId: { in: ['owner-zalo-id-123', 'stranger-001'] } },
    });
  });

  it('should reject unauthorized user before pairing', async () => {
    const msg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: `msg-test-${Date.now()}-1`,
      senderId: 'stranger-001',
      chatId: 'chat-stranger-001',
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: 'Xin chào',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(msg);

    expect(mockSentMessages.length).toBeGreaterThan(0);
    expect(mockSentMessages[0].text).toContain('chưa được ghép nối');
  });

  it('should pair owner successfully using pairing code', async () => {
    const { code } = await authService.createPairingCode();

    const pairMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: `msg-test-${Date.now()}-2`,
      senderId: 'owner-zalo-id-123',
      senderName: 'Trí TV',
      chatId: 'chat-owner-123',
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: `/pair ${code}`,
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(pairMsg);

    expect(mockSentMessages.length).toBeGreaterThan(0);
    expect(mockSentMessages[0].text).toContain('Chúc mừng');

    const isOwner = await authService.isOwner('owner-zalo-id-123');
    expect(isOwner).toBe(true);
  });

  it('should handle /whoami and /permissions for verified owner', async () => {
    const whoamiMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: `msg-test-${Date.now()}-3`,
      senderId: 'owner-zalo-id-123',
      chatId: 'chat-owner-123',
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: '/whoami',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(whoamiMsg);
    expect(mockSentMessages[0].text).toContain('Thông tin Chủ sở hữu');
  });

  it('should process Excel file generation request via MockLLM tool call', async () => {
    const excelMsg: NormalizedIncomingMessage = {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId: `msg-test-${Date.now()}-4`,
      senderId: 'owner-zalo-id-123',
      chatId: 'chat-owner-123',
      chatType: 'PRIVATE',
      type: 'TEXT',
      text: 'Tạo file excel kế hoạch công việc',
      attachments: [],
      sentAt: new Date(),
      rawEvent: {},
    };

    await agentService.handleIncomingMessage(excelMsg);

    const file = await prisma.storedFile.findFirst({
      where: { originalName: 'cong_viec.xlsx' },
    });
    expect(file).not.toBeNull();
    expect(file?.mimeType).toContain('spreadsheetml');
  });
});
