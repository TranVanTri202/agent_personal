import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterClientProvider } from './openrouter.client';
import { OpenRouterModelCatalogService } from './openrouter.catalog';
import { OpenRouterUsageService } from './openrouter.usage';
import { mapOpenRouterError, OpenRouterCapabilityError } from './openrouter.error-mapper';
import { LLMMessage, ToolCall, UnifiedLLMResponse } from '../llm.types';
import { ResolvedModel, LLMExecutionContext } from '../routing/task-category';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

@Injectable()
export class OpenRouterGateway {
  private readonly maxRetries: number;
  private readonly maxOutputTokens: number;
  private readonly allowProviderFallbacks: boolean;
  private readonly denyDataCollection: boolean;
  private readonly requireZdr: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly clientProvider: OpenRouterClientProvider,
    private readonly catalog: OpenRouterModelCatalogService,
    private readonly usageService: OpenRouterUsageService,
    private readonly logger: AppLoggerService,
  ) {
    this.maxRetries = this.configService.get<number>('LLM_MAX_RETRIES') ?? 2;
    this.maxOutputTokens = this.configService.get<number>('LLM_MAX_OUTPUT_TOKENS') || 4096;
    this.allowProviderFallbacks = this.configService.get<boolean>('OPENROUTER_ALLOW_PROVIDER_FALLBACKS') ?? true;
    this.denyDataCollection = this.configService.get<boolean>('OPENROUTER_DENY_DATA_COLLECTION') ?? true;
    this.requireZdr = this.configService.get<boolean>('OPENROUTER_REQUIRE_ZDR') ?? false;
  }

  isConfigured(): boolean {
    return this.clientProvider.isConfigured();
  }

  async execute(
    messages: LLMMessage[],
    tools: any[] | undefined,
    resolved: ResolvedModel,
    context?: LLMExecutionContext,
  ): Promise<UnifiedLLMResponse> {
    if (!this.clientProvider.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY is not configured in .env');
    }

    // Capability check: Tools
    if (tools && tools.length > 0) {
      const hasToolSupport = await this.catalog.supportsTools(resolved.modelId);
      if (!hasToolSupport) {
        throw new OpenRouterCapabilityError(
          resolved.modelId,
          'tools',
          `Model "${resolved.modelId}" không hỗ trợ Tool Calling (function calling). ` +
            (resolved.mode === 'single'
              ? `Vui lòng đổi LLM_SINGLE_MODEL sang model hỗ trợ tool (ví dụ: openai/gpt-4o-mini hoặc anthropic/claude-3.5-haiku).`
              : `Vui lòng cấu hình task model cho "tool_calling" trong config/llm-routing.json.`),
        );
      }
    }

    // Capability check: Vision
    if (context?.requiresVision) {
      const hasVisionSupport = await this.catalog.supportsVision(resolved.modelId);
      if (!hasVisionSupport) {
        throw new OpenRouterCapabilityError(
          resolved.modelId,
          'image_input',
          `Model "${resolved.modelId}" không hỗ trợ xử lý hình ảnh (Vision). ` +
            (resolved.mode === 'single'
              ? `Vui lòng chọn model hỗ trợ vision (ví dụ: openai/gpt-4o-mini hoặc google/gemini-flash-1.5).`
              : `Vui lòng cấu hình task model cho "image_understanding" trong config/llm-routing.json.`),
        );
      }
    }

    // Check budget before dispatching request
    await this.usageService.checkBudgetBeforeRequest();

    const client = this.clientProvider.getClient();
    let attempt = 0;
    const startTime = Date.now();

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const extraBody: Record<string, any> = {};

        // Provider routing & privacy preferences
        const providerConfig: Record<string, any> = {};
        if (!this.allowProviderFallbacks) {
          providerConfig.allow_fallbacks = false;
        }
        if (this.denyDataCollection) {
          providerConfig.data_collection = 'deny';
        }
        if (this.requireZdr) {
          providerConfig.zdr = true;
        }
        if (Object.keys(providerConfig).length > 0) {
          extraBody.provider = providerConfig;
        }

        const completion = await client.chat.completions.create(
          {
            model: resolved.modelId,
            messages: messages as any,
            tools: tools && tools.length > 0 ? (tools as any) : undefined,
            max_tokens: this.maxOutputTokens,
            ...extraBody,
          } as any,
        );

        const latencyMs = Date.now() - startTime;
        const choice = completion.choices[0];
        const msg = choice?.message;
        const actualModel = completion.model || resolved.modelId;

        // Extract tool calls
        const toolCalls: ToolCall[] = [];
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            try {
              toolCalls.push({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments || '{}'),
              });
            } catch (err: any) {
              this.logger.error(`[OPENROUTER_TOOL_PARSE_ERROR] Failed parsing arguments for tool ${tc.function.name}: ${err.message}`);
            }
          }
        }

        // Extract usage and cost
        const rawUsage: any = completion.usage || {};
        const promptTokens = rawUsage.prompt_tokens || 0;
        const completionTokens = rawUsage.completion_tokens || 0;
        const totalTokens = rawUsage.total_tokens || promptTokens + completionTokens;
        const costUsd = typeof rawUsage.cost === 'number' ? rawUsage.cost : rawUsage.total_cost || undefined;

        // Record usage asynchronously
        this.usageService.recordUsage({
          taskId: context?.taskId,
          conversationId: context?.conversationId,
          ownerId: context?.ownerId,
          routingMode: resolved.mode,
          taskCategory: resolved.category,
          requestedModel: resolved.modelId,
          actualModel,
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd,
          latencyMs,
          routingReason: resolved.reason,
        });

        return {
          requestedModel: resolved.modelId,
          actualModel,
          content: msg?.content || null,
          toolCalls,
          finishReason: choice?.finish_reason,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
          },
          latencyMs,
        };
      } catch (err: any) {
        const mappedError = mapOpenRouterError(err);
        const isRetryable = (mappedError as any).isRetryable ?? false;

        if (isRetryable && attempt <= this.maxRetries) {
          const delayMs = Math.min(10000, Math.pow(2, attempt) * 1000);
          this.logger.warn(
            `[OPENROUTER_RETRY] Request failed with ${mappedError.message}. Retrying attempt ${attempt}/${this.maxRetries} in ${delayMs}ms...`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        this.logger.error(`[OPENROUTER_GATEWAY_ERROR] Model: ${resolved.modelId}, Error: ${mappedError.message}`);
        throw mappedError;
      }
    }

    throw new Error(`OpenRouter gateway exceeded ${this.maxRetries} retries`);
  }
}
