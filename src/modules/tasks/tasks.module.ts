import { Global, Module } from '@nestjs/common';
import { TaskProgressService } from './task-progress.service';

@Global()
@Module({
  providers: [TaskProgressService],
  exports: [TaskProgressService],
})
export class TasksModule {}
