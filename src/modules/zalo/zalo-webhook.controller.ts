import { Controller, Post, Headers, Body, UnauthorizedException, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'zalo-bot-js';
import { ZALO_BOT_INSTANCE } from './zalo-bot.provider';
import { ZaloEventNormalizer } from './zalo-event.normalizer';
import { AgentService } from '../agent/agent.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Controller('api/webhooks/zalo')
export class ZaloWebhookController {
  private readonly webhookSecret: string;
  private readonly mode: string;

  constructor(
    @Inject(ZALO_BOT_INSTANCE) private readonly bot: Bot,
    private readonly configService: ConfigService,
    private readonly normalizer: ZaloEventNormalizer,
    private readonly agentService: AgentService,
    private readonly logger: AppLoggerService,
  ) {
    this.webhookSecret = this.configService.get<string>('ZALO_WEBHOOK_SECRET') || '';
    this.mode = (this.configService.get<string>('ZALO_MODE') || 'polling').toLowerCase();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-bot-api-secret-token') secretToken: string,
    @Body() payload: any,
  ) {
    if (this.webhookSecret && secretToken !== this.webhookSecret) {
      this.logger.warn('[ZALO_WEBHOOK] Unauthorized webhook request (invalid secret token)');
      throw new UnauthorizedException('Invalid secret token');
    }

    if (this.mode !== 'webhook') {
      this.logger.warn(`[ZALO_WEBHOOK_MODE_MISMATCH] Received webhook event while ZALO_MODE is "${this.mode}".`);
    }

    // Process asynchronously through zalo-bot-js SDK processUpdate
    setImmediate(async () => {
      try {
        await this.bot.processUpdate(payload);
      } catch (err: any) {
        this.logger.error(
          `[ZALO_WEBHOOK_SDK_ERROR] bot.processUpdate failed: ${err.message}. Invoking direct normalizer fallback...`,
        );
        try {
          const fallbackNorm = this.normalizer.normalize(payload);
          if (fallbackNorm) {
            await this.agentService.handleIncomingMessage(fallbackNorm);
          }
        } catch (fbErr: any) {
          this.logger.error(`[ZALO_WEBHOOK_FALLBACK_ERROR] ${fbErr.message}`);
        }
      }
    });

    return { ok: true };
  }
}
