import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerService } from './logger/pino-logger.service';
import { EncryptionService } from './security/encryption.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AppLoggerService, EncryptionService],
  exports: [AppLoggerService, EncryptionService],
})
export class CommonModule {}
