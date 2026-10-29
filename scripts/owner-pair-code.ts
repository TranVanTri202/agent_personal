import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

async function generatePairingCode() {
  const prisma = new PrismaClient();

  try {
    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    if (existingOwner) {
      console.log('⚠️ CẢNH BÁO: Hệ thống đã có chủ sở hữu (Owner):');
      console.log(`   User ID: ${existingOwner.zaloUserId}`);
      console.log(`   Display Name: ${existingOwner.displayName || 'Owner'}`);
      console.log('\nNếu muốn đổi chủ sở hữu, hãy cập nhật DB hoặc chạy script reset.');
      return;
    }

    // Generate 6-digit random code
    const digits = '0123456789';
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += digits[bytes[i] % digits.length];
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await prisma.pairingToken.create({
      data: {
        codeHash,
        expiresAt,
        isUsed: false,
      },
    });

    console.log('========================================================');
    console.log('🔑 MÃ GHÉP NỐI CHỦ SỞ HỮU (OWNER PAIRING CODE):');
    console.log(`\n           👉   ${code}   👈\n`);
    console.log(`• Thời hạn: 5 phút (hết hạn lúc: ${expiresAt.toLocaleTimeString('vi-VN')})`);
    console.log('• Hướng dẫn: Mở Zalo, tìm Bot của bạn và gửi tin nhắn:');
    console.log(`\n           /pair ${code}\n`);
    console.log('========================================================');
  } catch (err: any) {
    console.error('Lỗi khi tạo mã pairing:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

generatePairingCode();
