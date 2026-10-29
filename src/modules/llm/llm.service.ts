import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterGateway } from './openrouter/openrouter.gateway';
import { MockLLMProvider } from './mock-llm.provider';
import { LLMRoutingService } from './routing/llm-routing.service';
import { TaskClassifierService } from './routing/task-classifier.service';
import { LLMMessage, UnifiedLLMResponse } from './llm.types';
import { LLMExecutionContext, ResolvedModel } from './routing/task-category';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class LLMService {
  private lastUsedModel?: string;
  private lastUsedCategory?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly openRouterGateway: OpenRouterGateway,
    private readonly mockProvider: MockLLMProvider,
    private readonly routingService: LLMRoutingService,
    private readonly classifier: TaskClassifierService,
    private readonly logger: AppLoggerService,
  ) {}

  getLastUsedModel(): string | undefined {
    return this.lastUsedModel;
  }

  getLastUsedCategory(): string | undefined {
    return this.lastUsedCategory;
  }

  getRoutingMode(): string {
    return this.routingService.getMode();
  }

  async resolveModel(context?: LLMExecutionContext): Promise<ResolvedModel> {
    const safeContext = context || { category: 'chat' };
    return this.routingService.resolveModel(safeContext);
  }

  async chat(
    messages: LLMMessage[],
    tools?: any[],
    context?: Partial<LLMExecutionContext>,
  ): Promise<UnifiedLLMResponse> {
    const hasTools = Boolean(tools && tools.length > 0);
    const hasImageAttachment = Boolean(context?.requiresVision);

    // Classify category if not explicitly provided
    let category = context?.category;
    let classificationReason = 'Đã chỉ định sẵn trong execution context';

    if (!category) {
      const classified = this.classifier.classify(messages, hasTools, hasImageAttachment);
      category = classified.category;
      classificationReason = classified.reason;
    }

    const fullContext: LLMExecutionContext = {
      taskId: context?.taskId,
      conversationId: context?.conversationId,
      ownerId: context?.ownerId,
      category,
      requiresTools: hasTools,
      requiresVision: hasImageAttachment,
      sensitivity: context?.sensitivity || 'normal',
    };

    // Resolve model based on routing mode (single / task)
    const resolved = await this.routingService.resolveModel(fullContext);
    this.lastUsedModel = resolved.modelId;
    this.lastUsedCategory = resolved.category;

    this.logger.log(
      `[LLM_ROUTING] Category: ${resolved.category} -> Model: ${resolved.modelId} (Mode: ${resolved.mode}, Reason: ${resolved.reason})`,
    );

    // If OpenRouter is configured, call gateway
    if (this.openRouterGateway.isConfigured()) {
      return this.openRouterGateway.execute(messages, tools, resolved, fullContext);
    }

    // Offline / Mock fallback
    this.logger.warn(`[LLM_GATEWAY] OPENROUTER_API_KEY is not configured. Falling back to MockLLMProvider.`);
    return this.mockProvider.chat(messages, tools, resolved.modelId);
  }
}
