import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LocalStorageProvider } from './local-storage.provider';
import { SupabaseStorageClient } from './supabase-storage.client';
import { TemporaryStorageService } from './temporary-storage.service';
import { TemporaryFileCleanupProcessor } from './temporary-file-cleanup.processor';
import { TemporaryFileSweeperService } from './temporary-file-sweeper.service';
import { StorageService } from './storage.service';
import { TEMPORARY_FILES_QUEUE_NAME } from './temporary-storage.types';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: TEMPORARY_FILES_QUEUE_NAME,
    }),
  ],
  providers: [
    LocalStorageProvider,
    SupabaseStorageClient,
    TemporaryStorageService,
    TemporaryFileCleanupProcessor,
    TemporaryFileSweeperService,
    StorageService,
  ],
  exports: [
    StorageService,
    TemporaryStorageService,
    SupabaseStorageClient,
    LocalStorageProvider,
  ],
})
export class StorageModule {}
