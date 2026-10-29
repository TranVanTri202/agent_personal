import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTask, TaskStatus } from '@prisma/client';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export const TASK_QUEUE_NAME = 'agent-tasks';

export interface TaskJobData {
  taskId: string;
  ownerId: string;
  conversationId: string;
  chatId: string;
  request: string;
}

@Injectable()
export class TaskQueueService {
  constructor(
    @InjectQueue(TASK_QUEUE_NAME) private readonly taskQueue: Queue<TaskJobData>,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  async createTaskAndEnqueue(params: {
    ownerId: string;
    conversationId: string;
    chatId: string;
    request: string;
    title?: string;
  }): Promise<AgentTask> {
    const task = await this.prisma.agentTask.create({
      data: {
        ownerId: params.ownerId,
        conversationId: params.conversationId,
        request: params.request,
        title: params.title || params.request.slice(0, 50),
        status: TaskStatus.PENDING,
      },
    });

    await this.taskQueue.add(
      'run-agent-task',
      {
        taskId: task.id,
        ownerId: params.ownerId,
        conversationId: params.conversationId,
        chatId: params.chatId,
        request: params.request,
      },
      {
        jobId: `task-${task.id}`,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(`[TASK_QUEUE] Enqueued task #${task.id} for owner ${params.ownerId}`);
    return task;
  }

  async getTask(taskId: string): Promise<AgentTask | null> {
    return this.prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        storedFiles: true,
        approvals: true,
      },
    });
  }

  async listRecentTasks(ownerId: string, limit = 10): Promise<AgentTask[]> {
    return this.prisma.agentTask.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async cancelTask(taskId: string, ownerId: string): Promise<{ success: boolean; message: string }> {
    const task = await this.prisma.agentTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return { success: false, message: `Không tìm thấy task #${taskId}` };
    }

    if (task.ownerId !== ownerId) {
      return { success: false, message: 'Bạn không có quyền hủy task này.' };
    }

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      return { success: false, message: `Task #${taskId} đã kết thúc với trạng thái: ${task.status}` };
    }

    await this.prisma.agentTask.update({
      where: { id: taskId },
      data: { status: TaskStatus.CANCELLED, completedAt: new Date() },
    });

    return { success: true, message: `Đã hủy task #${taskId} thành công.` };
  }
}
