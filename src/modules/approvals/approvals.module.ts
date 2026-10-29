import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

@Global()
@Module({
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
