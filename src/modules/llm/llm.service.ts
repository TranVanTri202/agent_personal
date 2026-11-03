import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OpenRouterGateway } from './openrouter/openrouter.gateway';
import { OpenRouterClientProvider } from './openrouter/openrouter.client';
import { MockLLMProvider } from './mock-llm.provider';
import { LLMRoutingService } from './routing/llm-routing.service';
import { TaskClassifierService } from './routing/task-classifier.service';
import { LLMMessage, UnifiedLLMResponse } from './llm.types';
import { LLMExecutionContext, ResolvedModel } from './routing/task-category';
import { SsrfValidator } from '../../common/security/ssrf.validator';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class LLMService {
  private lastUsedModel?: string;
  private lastUsedCategory?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly openRouterGateway: OpenRouterGateway,
    private readonly openRouterClient: OpenRouterClientProvider,
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

  /**
   * Speech-to-Text (STT) transcription for incoming Zalo voice messages.
   */
  async transcribeAudio(audioUrl: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      await SsrfValidator.assertSafeUrl(audioUrl);

      const res = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
        maxContentLength: 20 * 1024 * 1024, // 20MB max
      });

      const buffer = Buffer.from(res.data);
      const base64Audio = buffer.toString('base64');
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      const lowerUrl = audioUrl.toLowerCase();

      let format = 'mp3';
      if (lowerUrl.includes('.wav') || contentType.includes('wav')) format = 'wav';
      else if (lowerUrl.includes('.ogg') || contentType.includes('ogg')) format = 'ogg';
      else if (lowerUrl.includes('.m4a') || lowerUrl.includes('.aac') || contentType.includes('aac') || contentType.includes('mp4'))
        format = 'm4a';

      if (!this.openRouterClient.isConfigured()) {
        return {
          success: false,
          error: 'OPENROUTER_API_KEY chưa được cấu hình để nhận diện giọng nói (STT).',
        };
      }

      const client = this.openRouterClient.getClient();
      const sttModel = 'google/gemini-2.0-flash-001';

      const completion = await client.chat.completions.create({
        model: sttModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Hãy chép lời (transcribe) chính xác 100% nội dung tiếng Việt trong đoạn ghi âm này thành văn bản. Chỉ trả về đúng câu nói của người dùng, không thêm bất kỳ lời giải thích hay ngoặc kép nào.',
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format,
                },
              },
            ],
          } as any,
        ],
        max_tokens: 1024,
      } as any);

      const transcript = (completion.choices[0]?.message?.content || '').trim();
      if (!transcript) {
        return { success: false, error: 'Không nhận diện được lời nói trong đoạn ghi âm.' };
      }

      this.logger.log(`[VOICE_STT] Transcribed voice message (${buffer.length} bytes): "${transcript}"`);
      return { success: true, text: transcript };
    } catch (err: any) {
      this.logger.error(`[VOICE_STT_ERROR] Failed transcribing audio from ${audioUrl}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
