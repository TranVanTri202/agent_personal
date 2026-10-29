import { Global, Module } from '@nestjs/common';
import { OpenRouterClientProvider } from './openrouter/openrouter.client';
import { OpenRouterModelCatalogService } from './openrouter/openrouter.catalog';
import { OpenRouterUsageService } from './openrouter/openrouter.usage';
import { OpenRouterGateway } from './openrouter/openrouter.gateway';
import { TaskClassifierService } from './routing/task-classifier.service';
import { AdaptiveSelectorService } from './routing/adaptive-selector.service';
import { LLMRoutingService } from './routing/llm-routing.service';
import { MockLLMProvider } from './mock-llm.provider';
import { LLMService } from './llm.service';

@Global()
@Module({
  providers: [
    OpenRouterClientProvider,
    OpenRouterModelCatalogService,
    OpenRouterUsageService,
    OpenRouterGateway,
    TaskClassifierService,
    AdaptiveSelectorService,
    LLMRoutingService,
    MockLLMProvider,
    LLMService,
  ],
  exports: [
    LLMService,
    LLMRoutingService,
    OpenRouterModelCatalogService,
    OpenRouterUsageService,
    OpenRouterClientProvider,
    MockLLMProvider,
    OpenRouterGateway,
  ],
})
export class LLMModule {}
