import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Message, EventMetadata } from 'zalo-bot-js';
import { ZALO_BOT_INSTANCE } from './zalo-bot.provider';
import { ZaloChannelAdapter } from './zalo-channel.adapter';
import { ZaloEventNormalizer } from './zalo-event.normalizer';
import { AgentService } from '../agent/agent.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class ZaloPollerService implements OnModuleInit, OnModuleDestroy {
  private isRunning = false;
  private readonly pollTimeoutSeconds: number;
  private readonly mode: string;
  private handlerAttached = false;

  constructor(
    @Inject(ZALO_BOT_INSTANCE) private readonly bot: Bot,
    private readonly configService: ConfigService,
    private readonly adapter: ZaloChannelAdapter,
    private readonly normalizer: ZaloEventNormalizer,
    private readonly agentService: AgentService,
    private readonly logger: AppLoggerService,
  ) {
    this.pollTimeoutSeconds = this.configService.get<number>('ZALO_POLL_TIMEOUT_SECONDS') || 30;
    this.mode = (this.configService.get<string>('ZALO_MODE') || 'polling').toLowerCase();
  }

  async onModuleInit() {
    this.attachCanonicalHandler();

    if (this.mode === 'polling' && process.env.NODE_ENV !== 'test') {
      await this.startPolling();
    } else if (process.env.NODE_ENV === 'test') {
      this.logger.log('[ZALO_RECEIVER] Test environment detected: background polling loop paused.');
    } else {
      this.logger.log(`[ZALO_RECEIVER] Running in mode "${this.mode}". Long polling is disabled; waiting for webhook events.`);
    }
  }

  async onModuleDestroy() {
    await this.stopPolling();
  }

  /**
   * Attaches one single canonical listener on SDK 'message' event to prevent double-dispatch.
   */
  private attachCanonicalHandler() {
    if (this.handlerAttached) return;
    this.handlerAttached = true;

    this.bot.on('message', async (message: Message, metadata: EventMetadata) => {
      try {
        const normalized = this.normalizer.normalizeSdkMessage(message, metadata);
        if (normalized) {
          this.logger.log(
            `[ZALO] Received event: ${normalized.type} from sender ${normalized.senderId} (chat: ${normalized.chatId})`,
          );
          await this.agentService.handleIncomingMessage(normalized);
        }
      } catch (err: any) {
        this.logger.error(`[ZALO_HANDLER_ERROR] Error handling incoming message: ${err.message}`, {
          stack: err.stack,
        });
      }
    });

    this.bot.onError(async (err, ctx) => {
      const sanitized = (err instanceof Error ? err.message : String(err)).replace(
        /\/bot([^/]+)\//g,
        '/bot[REDACTED_TOKEN]/',
      );
      this.logger.warn(`[ZALO_SDK_POLLING_ERROR] [${ctx?.source || 'unknown'}]: ${sanitized}`);
    });
  }

  async startPolling() {
    if (this.isRunning) return;

    if (!this.adapter.hasToken()) {
      this.logger.warn(
        '[ZALO_POLLER] ZALO_BOT_TOKEN is not configured. Polling will not start until token is set.',
      );
      return;
    }

    // Check webhook conflict
    try {
      const webhookInfo = await this.adapter.getWebhookInfo();
      if (webhookInfo?.result?.url) {
        this.logger.warn(
          `[ZALO_POLLER_CONFLICT] Bot currently has an active webhook configured (${webhookInfo.result.url}). ` +
            `Long polling will not receive updates until the webhook is deleted. Run "npm run zalo:webhook:delete" to switch to polling mode.`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`[ZALO_POLLER] Could not check webhook status: ${e.message}`);
    }

    this.isRunning = true;
    this.logger.log(`[ZALO_POLLER] Starting zalo-bot-js long polling (timeout: ${this.pollTimeoutSeconds}s)...`);

    // Note: bot.startPolling returns the ongoing polling task promise.
    // We launch it asynchronously in background without blocking NestJS lifecycle init.
    this.bot.startPolling({
      timeoutSeconds: this.pollTimeoutSeconds,
    }).catch((err: any) => {
      this.isRunning = false;
      this.logger.error(`[ZALO_POLLER_LOOP_ERROR] Polling loop error: ${err.message}`);
    });
  }

  async stopPolling() {
    if (!this.isRunning && !this.bot.isPolling()) return;
    this.isRunning = false;

    try {
      this.bot.stopPolling();
      await this.bot.shutdown();
      this.logger.log('[ZALO_POLLER] Polling stopped and bot instance shut down cleanly.');
    } catch (err: any) {
      this.logger.warn(`[ZALO_POLLER_SHUTDOWN_WARN] ${err.message}`);
    }
  }

  isPollingActive(): boolean {
    return this.bot.isPolling();
  }
}
