// Mark process as dedicated background worker so ZaloPollerService does not double-poll
process.env.IS_WORKER_PROCESS = 'true';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLoggerService } from './common/logger/pino-logger.service';

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  logger.log('⚙️ Personal Zalo AI Agent Worker process started (Zalo polling skipped to avoid conflict with main server)...');

  // Handle graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.log(`Worker received ${signal}. Closing context...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrapWorker();
