import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

export interface OpenRouterModelPricing {
  prompt: string; // e.g. "0.00000015"
  completion: string;
  image?: string;
  request?: string;
}

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string; // e.g. "text+image->text"
    tokenizer?: string;
    instruct_type?: string;
  };
  pricing?: OpenRouterModelPricing;
  supported_parameters?: string[]; // e.g. ["tools", "temperature", "max_tokens", "structured_outputs"]
}

// Built-in fallback catalog metadata for offline/startup validation
export const KNOWN_MODELS_FALLBACK: Record<string, Partial<OpenRouterModelInfo>> = {
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'OpenAI: GPT-4o-mini',
    context_length: 128000,
    supported_parameters: ['tools', 'tool_choice', 'temperature', 'structured_outputs', 'max_tokens'],
    architecture: { modality: 'text+image->text' },
  },
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    context_length: 128000,
    supported_parameters: ['tools', 'tool_choice', 'temperature', 'structured_outputs', 'max_tokens'],
    architecture: { modality: 'text+image->text' },
  },
  'anthropic/claude-3.5-haiku': {
    id: 'anthropic/claude-3.5-haiku',
    name: 'Anthropic: Claude 3.5 Haiku',
    context_length: 200000,
    supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens'],
    architecture: { modality: 'text+image->text' },
  },
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Anthropic: Claude 3.5 Sonnet',
    context_length: 200000,
    supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens'],
    architecture: { modality: 'text+image->text' },
  },
  'google/gemini-flash-1.5': {
    id: 'google/gemini-flash-1.5',
    name: 'Google: Gemini Flash 1.5',
    context_length: 1000000,
    supported_parameters: ['tools', 'tool_choice', 'temperature', 'max_tokens'],
    architecture: { modality: 'text+image->text' },
  },
  'deepseek/deepseek-chat': {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek: DeepSeek V3',
    context_length: 64000,
    supported_parameters: ['tools', 'temperature', 'max_tokens'],
    architecture: { modality: 'text->text' },
  },
};

@Injectable()
export class OpenRouterModelCatalogService implements OnModuleInit {
  private cache = new Map<string, OpenRouterModelInfo>();
  private lastFetchedAt = 0;
  private readonly ttlMs: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly validateOnStartup: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const ttlMinutes = this.configService.get<number>('LLM_MODEL_CATALOG_CACHE_TTL_MINUTES') || 360;
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.baseUrl = this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.validateOnStartup = this.configService.get<boolean>('LLM_VALIDATE_MODEL_ON_STARTUP') ?? true;

    // Pre-populate with fallback knowledge
    for (const [id, info] of Object.entries(KNOWN_MODELS_FALLBACK)) {
      this.cache.set(id, info as OpenRouterModelInfo);
    }
  }

  async onModuleInit() {
    if (this.validateOnStartup && this.apiKey) {
      this.refreshCatalog().catch((err) => {
        this.logger.warn(`[OPENROUTER_CATALOG] Could not refresh catalog on startup: ${err.message}. Using cached fallbacks.`);
      });
    }
  }

  async refreshCatalog(): Promise<void> {
    try {
      this.logger.log(`[OPENROUTER_CATALOG] Fetching model catalog from ${this.baseUrl}/models`);
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const res = await axios.get(`${this.baseUrl}/models`, {
        headers,
        timeout: 15000,
      });

      const models: OpenRouterModelInfo[] = res.data?.data || [];
      for (const m of models) {
        if (m && m.id) {
          this.cache.set(m.id, m);
        }
      }
      this.lastFetchedAt = Date.now();
      this.logger.log(`[OPENROUTER_CATALOG] Loaded ${this.cache.size} models from OpenRouter catalog.`);
    } catch (err: any) {
      this.logger.warn(`[OPENROUTER_CATALOG] Failed to fetch remote catalog: ${err.message}`);
      throw err;
    }
  }

  async getModel(modelId: string): Promise<OpenRouterModelInfo | undefined> {
    if (this.cache.size <= Object.keys(KNOWN_MODELS_FALLBACK).length && Date.now() - this.lastFetchedAt > this.ttlMs && this.apiKey) {
      await this.refreshCatalog().catch(() => {});
    }
    return this.cache.get(modelId) || (KNOWN_MODELS_FALLBACK[modelId] as OpenRouterModelInfo | undefined);
  }

  async getAllCachedModels(): Promise<OpenRouterModelInfo[]> {
    return Array.from(this.cache.values());
  }

  async supportsTools(modelId: string): Promise<boolean> {
    const info = await this.getModel(modelId);
    if (!info) {
      // If model is unknown, assume true only if it contains 'gpt', 'claude', 'gemini' or 'tool'
      return /gpt|claude|gemini|mistral|deepseek/i.test(modelId);
    }
    const params = info.supported_parameters || [];
    return params.includes('tools') || params.includes('tool_choice');
  }

  async supportsVision(modelId: string): Promise<boolean> {
    const info = await this.getModel(modelId);
    if (!info) {
      return /vision|gpt-4o|gemini|claude-3/i.test(modelId);
    }
    const modality = info.architecture?.modality || '';
    return modality.includes('image');
  }

  async supportsStructuredOutputs(modelId: string): Promise<boolean> {
    const info = await this.getModel(modelId);
    if (!info) return false;
    const params = info.supported_parameters || [];
    return params.includes('structured_outputs') || params.includes('json_schema');
  }

  async validateModel(modelId: string): Promise<{ valid: boolean; reason?: string }> {
    const info = await this.getModel(modelId);
    if (!info) {
      return {
        valid: false,
        reason: `Model "${modelId}" is not found in OpenRouter catalog. Check spelling at https://openrouter.ai/models.`,
      };
    }
    return { valid: true };
  }
}
