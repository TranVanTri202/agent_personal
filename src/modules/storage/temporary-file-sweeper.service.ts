import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TemporaryStorageService } from './temporary-storage.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class TemporaryFileSweeperService implements OnModuleInit, OnModuleDestroy {
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly temporaryStorageService: TemporaryStorageService,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit() {
    this.logger.log('[TEMP_STORAGE_SWEEPER] Initializing sweeper service and running initial startup sweep...');
    // Initial startup sweep
    await this.temporaryStorageService.sweepExpiredFiles().catch((err) => {
      this.logger.error(`[TEMP_STORAGE_SWEEPER_INIT_ERROR] Startup sweep failed: ${err.message}`);
    });

    // Schedule periodic sweep every 5 minutes
    this.sweepTimer = setInterval(() => {
      this.temporaryStorageService.sweepExpiredFiles().catch((err) => {
        this.logger.warn(`[TEMP_STORAGE_SWEEPER_INTERVAL_ERROR] Periodic sweep failed: ${err.message}`);
      });
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
