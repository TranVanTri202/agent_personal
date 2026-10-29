import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../../common/security/encryption.service';
import { Approval, ApprovalStatus } from '@prisma/client';

export interface CreateApprovalParams {
  taskId: string;
  ownerId: string;
  actionType: string;
  payload: any;
  ttlMinutes?: number;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async createApproval(params: CreateApprovalParams): Promise<{ approval: Approval; code: string }> {
    const code = this.encryption.generateRandomCode(6);
    const codeHash = this.encryption.hash(code);
    const exactActionHash = this.encryption.computeActionDigest(params.actionType, params.payload);
    const expiresAt = new Date(Date.now() + (params.ttlMinutes || 15) * 60 * 1000);

    const approval = await this.prisma.approval.create({
      data: {
        taskId: params.taskId,
        ownerId: params.ownerId,
        actionType: params.actionType,
        exactActionHash,
        encryptedOrRedactedPayload: params.payload,
        codeHash,
        status: ApprovalStatus.PENDING,
        expiresAt,
      },
    });

    return { approval, code };
  }

  async verifyAndConsume(
    code: string,
    ownerId: string,
    decision: 'APPROVE' | 'DENY',
  ): Promise<{ success: boolean; message: string; approval?: Approval }> {
    const codeHash = this.encryption.hash(code.trim());
    const approval = await this.prisma.approval.findUnique({
      where: { codeHash },
      include: { task: true },
    });

    if (!approval) {
      return { success: false, message: 'Mã phê duyệt không tồn tại hoặc đã hết hiệu lực.' };
    }

    if (approval.ownerId !== ownerId) {
      return { success: false, message: 'Bạn không có quyền thực hiện quyết định cho mã phê duyệt này.' };
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      return { success: false, message: `Yêu cầu này đã được xử lý trước đó (${approval.status}).` };
    }

    if (approval.expiresAt < new Date()) {
      await this.prisma.approval.update({
        where: { id: approval.id },
        data: { status: ApprovalStatus.EXPIRED },
      });
      return { success: false, message: 'Mã phê duyệt đã hết hạn (15 phút). Vui lòng yêu cầu lại thao tác.' };
    }

    const newStatus = decision === 'APPROVE' ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED;
    const updated = await this.prisma.approval.update({
      where: { id: approval.id },
      data: {
        status: newStatus,
        decidedAt: new Date(),
        executedAt: decision === 'APPROVE' ? new Date() : undefined,
      },
    });

    return {
      success: true,
      message:
        decision === 'APPROVE'
          ? `✅ Đã phê duyệt hành động [${approval.actionType}]. Hệ thống đang tiến hành thực thi.`
          : `❌ Đã từ chối hành động [${approval.actionType}]. Thao tác đã bị hủy bỏ an toàn.`,
      approval: updated,
    };
  }

  async listPending(ownerId: string): Promise<Approval[]> {
    return this.prisma.approval.findMany({
      where: {
        ownerId,
        status: ApprovalStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }
}
