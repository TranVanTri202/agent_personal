import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLoggerService } from './common/logger/pino-logger.service';

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  logger.log('⚙️ Personal Zalo AI Agent Worker process started and listening for BullMQ jobs...');

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
