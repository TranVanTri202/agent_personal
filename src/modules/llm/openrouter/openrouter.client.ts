import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenRouterClientProvider {
  private client: OpenAI | null = null;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly appName: string;
  private readonly appUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.baseURL = this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    this.appName = this.configService.get<string>('OPENROUTER_APP_NAME') || 'My Zalo Personal Agent';
    this.appUrl = this.configService.get<string>('OPENROUTER_APP_URL') || 'http://localhost:3000';
    this.timeoutMs = this.configService.get<number>('LLM_REQUEST_TIMEOUT_MS') || 60000;

    if (this.apiKey && this.apiKey.trim().length > 0) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        timeout: this.timeoutMs,
        defaultHeaders: {
          'HTTP-Referer': this.appUrl,
          'X-Title': this.appName,
        },
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.apiKey.trim().length > 0;
  }

  getClient(): OpenAI {
    if (!this.client) {
      throw new Error('OPENROUTER_API_KEY is not configured in .env');
    }
    return this.client;
  }
}
