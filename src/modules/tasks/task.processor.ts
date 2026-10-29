import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TASK_QUEUE_NAME, TaskJobData } from './task-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { TaskStatus } from '@prisma/client';

@Processor(TASK_QUEUE_NAME)
export class TaskProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<TaskJobData>): Promise<any> {
    this.logger.log(`[WORKER] Processing task job ${job.id} for task #${job.data.taskId}`);

    await this.prisma.agentTask.update({
      where: { id: job.data.taskId },
      data: {
        status: TaskStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    try {
      // Background execution completes
      await this.prisma.agentTask.update({
        where: { id: job.data.taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      return { success: true };
    } catch (err: any) {
      this.logger.error(`[WORKER_ERROR] Task #${job.data.taskId} failed: ${err.message}`);
      await this.prisma.agentTask.update({
        where: { id: job.data.taskId },
        data: {
          status: TaskStatus.FAILED,
          error: err.message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }
}
