import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

async function cleanupStorage() {
  console.log('🧹 === THỰC THI DỌN DẸP TỆP TIN TẠM HẾT HẠN (24H TTL) ===\n');

  const prisma = new PrismaClient();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'agent-temp';

  const supabase =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;

  try {
    const now = new Date();
    const expiredFiles = await prisma.storedFile.findMany({
      where: {
        status: { in: ['ACTIVE', 'DELETE_FAILED'] },
        expiresAt: { lte: now },
      },
      take: 100,
    });

    if (expiredFiles.length === 0) {
      console.log('✅ Không có tệp tin tạm nào đã hết hạn (> 24 giờ).');
      return;
    }

    console.log(`Tìm thấy ${expiredFiles.length} tệp tin đã quá hạn 24 giờ cần xóa khỏi Storage...`);
    let deletedCount = 0;

    for (const f of expiredFiles) {
      try {
        if (f.provider === 'SUPABASE' && supabase) {
          const { error } = await supabase.storage.from(bucketName).remove([f.objectKey]);
          if (error) {
            console.warn(`  ⚠️ Xóa object Supabase "${f.objectKey}" thất bại: ${error.message}`);
          }
        }

        await prisma.storedFile.update({
          where: { id: f.id },
          data: {
            status: 'DELETED',
            deletedAt: new Date(),
          },
        });

        deletedCount++;
        console.log(`  🗑️ Đã xóa: [${f.id.slice(0, 8)}] "${f.originalName}" (${f.objectKey})`);
      } catch (err: any) {
        console.error(`  ❌ Lỗi khi xử lý file #${f.id}: ${err.message}`);
      }
    }

    console.log(`\n🎉 Hoàn tất dọn dẹp: Đã xóa ${deletedCount}/${expiredFiles.length} tệp tin.`);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupStorage();
