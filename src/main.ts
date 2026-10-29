import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from './common/logger/pino-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port);
  logger.log(`🚀 Personal Zalo AI Agent HTTP server is running on http://localhost:${port}`);
  logger.log(`• Mode: ${configService.get('ZALO_MODE')}`);
  logger.log(`• Storage: ${configService.get('STORAGE_PROVIDER')}`);
  logger.log(`• Timezone: ${configService.get('APP_TIMEZONE')}`);
}

bootstrap();
