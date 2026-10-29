import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { LLMRoutingMode, LLMTaskCategory, LLMExecutionContext, ResolvedModel } from './task-category';
import { TaskRoutingConfig, TaskRoutingConfigSchema } from './routing-config.schema';
import { OpenRouterModelCatalogService } from '../openrouter/openrouter.catalog';
import { AdaptiveSelectorService } from './adaptive-selector.service';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

@Injectable()
export class LLMRoutingService implements OnModuleInit {
  private routingConfig!: TaskRoutingConfig;
  private readonly routingMode: LLMRoutingMode;
  private readonly singleModel: string;
  private readonly defaultModel: string;
  private readonly strategy: 'rules' | 'adaptive';
  private readonly configPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly catalog: OpenRouterModelCatalogService,
    private readonly adaptiveSelector: AdaptiveSelectorService,
    private readonly logger: AppLoggerService,
  ) {
    this.routingMode = (this.configService.get<string>('LLM_ROUTING_MODE') as LLMRoutingMode) || 'single';
    this.singleModel = this.configService.get<string>('LLM_SINGLE_MODEL') || 'openai/gpt-4o-mini';
    this.defaultModel = this.configService.get<string>('LLM_DEFAULT_MODEL') || 'openai/gpt-4o-mini';
    this.strategy = (this.configService.get<string>('LLM_TASK_ROUTING_STRATEGY') as 'rules' | 'adaptive') || 'rules';
    this.configPath = path.resolve(this.configService.get<string>('LLM_TASK_ROUTING_CONFIG') || './config/llm-routing.json');
  }

  onModuleInit() {
    this.loadConfig();
    this.logger.log(`[LLM_ROUTING] Initialized in "${this.routingMode.toUpperCase()}" mode.`);
    if (this.routingMode === 'single') {
      this.logger.log(`[LLM_ROUTING] Single model: "${this.singleModel}" (Task routing rules are ignored).`);
    } else {
      this.logger.log(`[LLM_ROUTING] Task routing strategy: "${this.strategy}", default model: "${this.routingConfig.defaultModel}".`);
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.routingConfig = TaskRoutingConfigSchema.parse(parsed);
      } else {
        this.logger.warn(`[LLM_ROUTING] Config file not found at ${this.configPath}. Using defaults.`);
        this.routingConfig = TaskRoutingConfigSchema.parse({
          version: 1,
          strategy: this.strategy,
          defaultModel: this.defaultModel,
          taskModels: {},
        });
      }

      if (this.routingConfig.adaptive?.enabled && this.routingConfig.adaptive.qualityScoresSource) {
        this.adaptiveSelector.loadEvaluationScores(this.routingConfig.adaptive.qualityScoresSource);
      }
    } catch (err: any) {
      this.logger.error(`[LLM_ROUTING] Failed to load routing config: ${err.message}. Falling back to default.`);
      this.routingConfig = TaskRoutingConfigSchema.parse({
        version: 1,
        strategy: 'rules',
        defaultModel: this.defaultModel,
        taskModels: {},
      });
    }
  }

  getMode(): LLMRoutingMode {
    return this.routingMode;
  }

  getConfig(): TaskRoutingConfig {
    return this.routingConfig;
  }

  getSingleModel(): string {
    return this.singleModel;
  }

  getDefaultModel(): string {
    return this.routingConfig.defaultModel || this.defaultModel;
  }

  async resolveModel(context: LLMExecutionContext): Promise<ResolvedModel> {
    // 1. Single mode: strictly returns LLM_SINGLE_MODEL
    if (this.routingMode === 'single') {
      let capabilityVerified = true;
      let reason = `Chế độ [single]: Tất cả tác vụ cố định sử dụng LLM_SINGLE_MODEL="${this.singleModel}".`;

      if (context.requiresTools) {
        const hasTools = await this.catalog.supportsTools(this.singleModel);
        if (!hasTools) {
          capabilityVerified = false;
          reason += ` ⚠️ Model ${this.singleModel} không hỗ trợ tool calling.`;
        }
      }

      if (context.requiresVision) {
        const hasVision = await this.catalog.supportsVision(this.singleModel);
        if (!hasVision) {
          capabilityVerified = false;
          reason += ` ⚠️ Model ${this.singleModel} không hỗ trợ đầu vào hình ảnh.`;
        }
      }

      return {
        modelId: this.singleModel,
        mode: 'single',
        category: context.category,
        reason,
        capabilityVerified,
        requiresTools: context.requiresTools,
        requiresVision: context.requiresVision,
      };
    }

    // 2. Task mode: Resolve by category and policy
    const category = context.category;

    // Check optional env overrides: LLM_TASK_MODEL_<CATEGORY_UPPER>
    const envKey = `LLM_TASK_MODEL_${category.toUpperCase()}`;
    const envOverride = this.configService.get<string>(envKey);
    if (envOverride && envOverride.trim().length > 0) {
      return {
        modelId: envOverride.trim(),
        mode: 'task',
        category,
        reason: `Route bởi biến môi trường ghi đè (${envKey})`,
        capabilityVerified: true,
      };
    }

    // Check adaptive strategy if enabled
    if (this.routingConfig.strategy === 'adaptive' && this.routingConfig.adaptive?.enabled) {
      const best = await this.adaptiveSelector.selectBestModel(category, this.routingConfig, {
        requiresTools: context.requiresTools,
        requiresVision: context.requiresVision,
      });
      if (best) {
        return {
          modelId: best.modelId,
          mode: 'task',
          category,
          reason: `Route bởi Adaptive Selector: ${best.reason}`,
          capabilityVerified: true,
        };
      }
    }

    // Rules strategy from config
    let modelId = this.routingConfig.taskModels[category];
    let reason = `Route bởi quy tắc cấu hình cho tác vụ "${category}" trong llm-routing.json`;

    if (!modelId) {
      modelId = this.routingConfig.defaultModel || this.defaultModel;
      reason = `Tác vụ "${category}" chưa có quy tắc riêng. Fallback sang default model: "${modelId}".`;
    }

    // Verify capability of resolved model
    let capabilityVerified = true;
    if (context.requiresTools) {
      const hasTools = await this.catalog.supportsTools(modelId);
      if (!hasTools) {
        capabilityVerified = false;
        reason += ` ⚠️ Model ${modelId} không hỗ trợ tools.`;
      }
    }
    if (context.requiresVision) {
      const hasVision = await this.catalog.supportsVision(modelId);
      if (!hasVision) {
        capabilityVerified = false;
        reason += ` ⚠️ Model ${modelId} không hỗ trợ vision.`;
      }
    }

    return {
      modelId,
      mode: 'task',
      category,
      reason,
      capabilityVerified,
      requiresTools: context.requiresTools,
      requiresVision: context.requiresVision,
    };
  }
}
