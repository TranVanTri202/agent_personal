import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TEMPORARY_FILES_QUEUE_NAME, DELETE_TEMPORARY_FILE_JOB } from './temporary-storage.types';
import { TemporaryStorageService } from './temporary-storage.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Processor(TEMPORARY_FILES_QUEUE_NAME)
export class TemporaryFileCleanupProcessor extends WorkerHost {
  constructor(
    private readonly temporaryStorageService: TemporaryStorageService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<{ fileId: string }>): Promise<any> {
    const { fileId } = job.data;
    this.logger.log(`[TEMP_FILE_WORKER] Processing 24h deletion job #${job.id} for File #${fileId}`);

    try {
      await this.temporaryStorageService.deleteExpiredFile(fileId);
      return { success: true, fileId };
    } catch (err: any) {
      this.logger.error(`[TEMP_FILE_WORKER_ERROR] Deletion job #${job.id} failed for File #${fileId}: ${err.message}`);
      throw err; // Trigger BullMQ retry with backoff
    }
  }
}
