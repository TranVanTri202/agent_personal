import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration';
import { PrismaModule } from './modules/prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { StorageModule } from './modules/storage/storage.module';
import { FilesModule } from './modules/files/files.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ToolsModule } from './modules/tools/tools.module';
import { LLMModule } from './modules/llm/llm.module';
import { GmailModule } from './modules/gmail/gmail.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AgentModule } from './modules/agent/agent.module';
import { ZaloModule } from './modules/zalo/zalo.module';
import { HealthModule } from './modules/health/health.module';
import { StickersModule } from './modules/stickers/stickers.module';
import { ImageGenerationModule } from './modules/image-generation/image-generation.module';
import { ConversationIntelligenceModule } from './modules/conversation-intelligence/conversation-intelligence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') || 'redis://localhost:6380';
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname || 'localhost',
            port: Number(url.port) || 6380,
            password: url.password || undefined,
          },
        };
      },
      inject: [ConfigService],
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
    TasksModule,
    SchedulerModule,
    AgentModule,
    ZaloModule,
    HealthModule,
    StickersModule,
    ImageGenerationModule,
    ConversationIntelligenceModule,
  ],
})
export class AppModule {}
