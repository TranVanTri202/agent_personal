import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerService, REMINDER_QUEUE_NAME } from './scheduler.service';
import { ReminderProcessor } from './reminder.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: REMINDER_QUEUE_NAME,
    }),
  ],
  providers: [SchedulerService, ReminderProcessor],
  exports: [SchedulerService],
})
export class SchedulerModule {}
