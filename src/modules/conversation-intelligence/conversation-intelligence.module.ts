import { Global, Module } from '@nestjs/common';
import { ConversationStateService } from './conversation-state.service';
import { ContextResolverService } from './context-resolver.service';

@Global()
@Module({
  providers: [ConversationStateService, ContextResolverService],
  exports: [ConversationStateService, ContextResolverService],
})
export class ConversationIntelligenceModule {}
