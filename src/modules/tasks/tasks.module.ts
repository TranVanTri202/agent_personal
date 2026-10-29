import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TaskQueueService, TASK_QUEUE_NAME } from './task-queue.service';
import { TaskProcessor } from './task.processor';
import { TaskProgressService } from './task-progress.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: TASK_QUEUE_NAME,
    }),
  ],
  providers: [TaskQueueService, TaskProcessor, TaskProgressService],
  exports: [TaskQueueService, TaskProgressService],
})
export class TasksModule {}
