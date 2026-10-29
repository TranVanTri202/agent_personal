import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../../common/logger/pino-logger.service';
import { OpenRouterBudgetError } from './openrouter.error-mapper';

export interface UsageRecordParams {
  taskId?: string;
  conversationId?: string;
  ownerId?: string;
  routingMode: 'single' | 'task';
  taskCategory: string;
  requestedModel: string;
  actualModel?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  latencyMs?: number;
  routingReason?: string;
}

@Injectable()
export class OpenRouterUsageService {
  private readonly maxUsdPerRequest: number;
  private readonly dailyBudgetUsd: number;
  private readonly monthlyBudgetUsd: number;
  private readonly trackUsage: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.maxUsdPerRequest = this.configService.get<number>('LLM_MAX_USD_PER_REQUEST') || 0.1;
    this.dailyBudgetUsd = this.configService.get<number>('LLM_DAILY_BUDGET_USD') || 1.0;
    this.monthlyBudgetUsd = this.configService.get<number>('LLM_MONTHLY_BUDGET_USD') || 20.0;
    this.trackUsage = this.configService.get<boolean>('LLM_TRACK_USAGE') ?? true;
  }

  async checkBudgetBeforeRequest(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyLogs = await this.prisma.lLMUsageLog.findMany({
      where: {
        createdAt: { gte: today },
      },
      select: { costUsd: true },
    });

    const dailySpent = dailyLogs.reduce((acc, curr) => acc + (curr.costUsd || 0), 0);
    if (dailySpent >= this.dailyBudgetUsd) {
      throw new OpenRouterBudgetError(
        `Đã chạm hạn mức ngân sách AI trong ngày ($${dailySpent.toFixed(4)} / $${this.dailyBudgetUsd.toFixed(2)} USD). Vui lòng tăng LLM_DAILY_BUDGET_USD trong .env nếu cần.`,
      );
    }
  }

  async recordUsage(params: UsageRecordParams): Promise<void> {
    if (!this.trackUsage) return;

    try {
      await this.prisma.lLMUsageLog.create({
        data: {
          taskId: params.taskId,
          conversationId: params.conversationId,
          ownerId: params.ownerId,
          routingMode: params.routingMode,
          taskCategory: params.taskCategory,
          requestedModel: params.requestedModel,
          actualModel: params.actualModel || params.requestedModel,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          totalTokens: params.totalTokens,
          costUsd: params.costUsd,
          latencyMs: params.latencyMs,
          routingReason: params.routingReason,
        },
      });

      this.logger.log(
        `[LLM_USAGE] Task ${params.taskCategory} with model ${params.actualModel || params.requestedModel}: ` +
          `${params.totalTokens} tokens (prompt: ${params.promptTokens}, completion: ${params.completionTokens}) ` +
          `${params.costUsd ? `cost: $${params.costUsd.toFixed(6)}` : ''} (${params.latencyMs || 0}ms)`,
      );
    } catch (err: any) {
      this.logger.warn(`[LLM_USAGE_RECORD_ERROR] Could not log LLM usage: ${err.message}`);
    }
  }

  async getDailyStats(): Promise<{ requests: number; tokens: number; costUsd: number; topModels: Record<string, number> }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await this.prisma.lLMUsageLog.findMany({
      where: { createdAt: { gte: today } },
    });

    let tokens = 0;
    let costUsd = 0;
    const topModels: Record<string, number> = {};

    for (const log of logs) {
      tokens += log.totalTokens;
      costUsd += log.costUsd || 0;
      const model = log.actualModel || log.requestedModel;
      topModels[model] = (topModels[model] || 0) + 1;
    }

    return {
      requests: logs.length,
      tokens,
      costUsd,
      topModels,
    };
  }
}
