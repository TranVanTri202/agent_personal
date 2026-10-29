import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LLMTaskCategory } from './task-category';
import { TaskRoutingConfig } from './routing-config.schema';
import { OpenRouterModelCatalogService } from '../openrouter/openrouter.catalog';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';

export interface SelectionScore {
  modelId: string;
  score: number;
  reason: string;
}

@Injectable()
export class AdaptiveSelectorService {
  private evaluationData: Record<string, any> = {};

  constructor(
    private readonly catalog: OpenRouterModelCatalogService,
    private readonly logger: AppLoggerService,
  ) {}

  loadEvaluationScores(filePath: string) {
    try {
      const fullPath = path.resolve(filePath);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.evaluationData = parsed.scores || {};
        this.logger.log(`[ADAPTIVE_SELECTOR] Loaded evaluation metrics for ${Object.keys(this.evaluationData).length} models.`);
      }
    } catch (err: any) {
      this.logger.warn(`[ADAPTIVE_SELECTOR] Could not load evaluations file (${filePath}): ${err.message}`);
    }
  }

  async selectBestModel(
    category: LLMTaskCategory,
    routingConfig: TaskRoutingConfig,
    requirements: { requiresTools?: boolean; requiresVision?: boolean },
  ): Promise<SelectionScore | undefined> {
    const candidates = routingConfig.adaptive?.candidateModelsByTask?.[category] || [];
    if (candidates.length === 0) {
      return undefined;
    }

    const profile = routingConfig.adaptive?.profile || 'balanced';
    const scoredList: SelectionScore[] = [];

    for (const modelId of candidates) {
      // Check allowlist / denylist
      if (routingConfig.modelDenylist?.includes(modelId)) continue;
      if (routingConfig.modelAllowlist?.length > 0 && !routingConfig.modelAllowlist.includes(modelId)) continue;

      // Capability checks
      if (requirements.requiresTools) {
        const hasTools = await this.catalog.supportsTools(modelId);
        if (!hasTools) continue;
      }
      if (requirements.requiresVision) {
        const hasVision = await this.catalog.supportsVision(modelId);
        if (!hasVision) continue;
      }

      const metrics = this.evaluationData[modelId] || {};
      const quality = metrics[category] ?? 0.8; // default benchmark
      const latencyMs = metrics.latency_p50_ms ?? 1000;

      // Scoring formulas based on profile
      let finalScore = quality * 100;
      if (profile === 'latency') {
        finalScore = quality * 50 + Math.max(0, 50 - latencyMs / 50);
      } else if (profile === 'economy') {
        // Boost cheaper models
        finalScore = quality * 60 + (modelId.includes('mini') || modelId.includes('flash') || modelId.includes('haiku') ? 40 : 10);
      } else if (profile === 'balanced') {
        finalScore = quality * 70 + Math.max(0, 30 - latencyMs / 100);
      }

      scoredList.push({
        modelId,
        score: finalScore,
        reason: `Adaptive profile [${profile}]: quality=${quality}, latency=${latencyMs}ms, finalScore=${finalScore.toFixed(1)}`,
      });
    }

    if (scoredList.length === 0) {
      return undefined;
    }

    // Sort descending by score
    scoredList.sort((a, b) => b.score - a.score);
    return scoredList[0];
  }
}
