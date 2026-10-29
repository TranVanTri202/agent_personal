import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'zalo-bot-js';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export const ZALO_BOT_INSTANCE = 'ZALO_BOT_INSTANCE';

export const ZaloBotProvider: Provider = {
  provide: ZALO_BOT_INSTANCE,
  inject: [ConfigService, AppLoggerService],
  useFactory: (configService: ConfigService, logger: AppLoggerService): Bot => {
    const token = configService.get<string>('ZALO_BOT_TOKEN') || '';
    if (!token) {
      logger.warn('[ZALO_BOT] ZALO_BOT_TOKEN is not set or empty.');
    }
    const bot = new Bot(token, {
      logger: {
        error: (msg, err, ctx) => {
          logger.error(
            `[ZALO_SDK_ERROR] ${msg}: ${err instanceof Error ? err.message : String(err)}`,
            { context: ctx?.source, kind: ctx?.kind },
          );
        },
      },
    });
    return bot;
  },
};
