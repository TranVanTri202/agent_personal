import { Global, Module } from '@nestjs/common';
import { ZaloBotProvider } from './zalo-bot.provider';
import { ZaloChannelAdapter } from './zalo-channel.adapter';
import { ZaloApiClient } from './zalo-api.client';
import { ZaloEventNormalizer } from './zalo-event.normalizer';
import { ZaloPollerService } from './zalo-poller.service';
import { ZaloWebhookController } from './zalo-webhook.controller';
import { ZALO_CHANNEL_TOKEN } from './zalo-channel.interface';

@Global()
@Module({
  controllers: [ZaloWebhookController],
  providers: [
    ZaloBotProvider,
    ZaloChannelAdapter,
    {
      provide: ZALO_CHANNEL_TOKEN,
      useExisting: ZaloChannelAdapter,
    },
    ZaloApiClient,
    ZaloEventNormalizer,
    ZaloPollerService,
  ],
  exports: [
    ZaloBotProvider,
    ZaloChannelAdapter,
    ZALO_CHANNEL_TOKEN,
    ZaloApiClient,
    ZaloEventNormalizer,
    ZaloPollerService,
  ],
})
export class ZaloModule {}
