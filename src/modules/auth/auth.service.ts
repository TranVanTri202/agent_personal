import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../../common/security/encryption.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface PairingResult {
  success: boolean;
  message: string;
  isOwner: boolean;
}

@Injectable()
export class AuthService {
  private readonly allowedUserIds: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const rawAllowed = this.configService.get<string>('ALLOWED_ZALO_USER_IDS') || '';
    this.allowedUserIds = new Set(
      rawAllowed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  async createPairingCode(): Promise<{ code: string; expiresAt: Date }> {
    const code = this.encryption.generateRandomCode(6);
    const codeHash = this.encryption.hash(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

    await this.prisma.pairingToken.create({
      data: {
        codeHash,
        expiresAt,
        isUsed: false,
      },
    });

    this.logger.log(`[AUTH] Generated new pairing code (expires at ${expiresAt.toISOString()})`);
    return { code, expiresAt };
  }

  async pairOwner(zaloUserId: string, code: string, displayName?: string): Promise<PairingResult> {
    const existingOwner = await this.prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    if (existingOwner) {
      if (existingOwner.zaloUserId === zaloUserId) {
        return {
          success: true,
          message: 'Bạn đã là chủ sở hữu (Owner) của Agent này rồi.',
          isOwner: true,
        };
      }
      return {
        success: false,
        message: 'Agent này đã có chủ sở hữu. Vui lòng liên hệ quản trị viên để reset quyền.',
        isOwner: false,
      };
    }

    const codeHash = this.encryption.hash(code.trim());
    const token = await this.prisma.pairingToken.findUnique({
      where: { codeHash },
    });

    if (!token || token.isUsed || token.expiresAt < new Date()) {
      return {
        success: false,
        message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn (5 phút). Vui lòng tạo mã mới qua CLI.',
        isOwner: false,
      };
    }

    // Mark token as used
    await this.prisma.pairingToken.update({
      where: { id: token.id },
      data: { isUsed: true, usedByZaloId: zaloUserId },
    });

    // Create or promote user to OWNER
    const user = await this.prisma.user.upsert({
      where: { zaloUserId },
      update: { role: 'OWNER', displayName: displayName || 'Owner' },
      create: {
        zaloUserId,
        displayName: displayName || 'Owner',
        role: 'OWNER',
      },
    });

    this.logger.log(`[AUTH] Successfully paired owner with Zalo User ID: ${zaloUserId}`);

    return {
      success: true,
      message: `🎉 Chúc mừng! Bạn đã xác thực thành công là Chủ sở hữu (Owner) của AI Agent.\nUser ID: ${user.zaloUserId}`,
      isOwner: true,
    };
  }

  async isOwner(zaloUserId: string): Promise<boolean> {
    const accessMode = this.configService.get<string>('BOT_ACCESS_MODE');
    if (accessMode === 'public') {
      return true;
    }

    if (this.allowedUserIds.has(zaloUserId)) {
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { zaloUserId },
    });

    return user?.role === 'OWNER';
  }

  async getOwner(): Promise<{ id: string; zaloUserId: string; displayName: string | null } | null> {
    return this.prisma.user.findFirst({
      where: { role: 'OWNER' },
      select: { id: true, zaloUserId: true, displayName: true },
    });
  }

  async revokeOwner(): Promise<boolean> {
    const updated = await this.prisma.user.updateMany({
      where: { role: 'OWNER' },
      data: { role: 'UNKNOWN' },
    });
    this.logger.warn(`[AUTH] Revoked all owner permissions (${updated.count} users)`);
    return updated.count > 0;
  }
}
