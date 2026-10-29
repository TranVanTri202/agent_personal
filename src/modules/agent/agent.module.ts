import { Global, Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationIntelligenceModule } from '../conversation-intelligence/conversation-intelligence.module';

@Global()
@Module({
  imports: [ConversationsModule, ConversationIntelligenceModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
