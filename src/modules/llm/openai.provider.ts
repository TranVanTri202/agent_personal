import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LLMMessage, LLMProvider, LLMResponse, ToolCall } from './llm.interface';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI | null = null;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';

    if (apiKey && apiKey.trim().length > 0) {
      this.client = new OpenAI({ apiKey });
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any,
        tools: tools && tools.length > 0 ? (tools as any) : undefined,
      });

      const choice = response.choices[0];
      const message = choice.message;
      const toolCalls: ToolCall[] = [];

      if (message.tool_calls) {
        for (const tc of message.tool_calls) {
          try {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}'),
            });
          } catch (e) {
            this.logger.error(`Failed to parse tool arguments for ${tc.function.name}: ${e}`);
          }
        }
      }

      return {
        requestedModel: this.model,
        actualModel: response.model || this.model,
        content: message.content,
        toolCalls,
        finishReason: choice.finish_reason,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err: any) {
      this.logger.error(`[OPENAI_ERROR] ${err.message}`);
      throw err;
    }
  }
}
