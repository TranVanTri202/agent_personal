import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

async function checkStorage() {
  console.log('🔍 === KIỂM TRA TÌNH TRẠNG LƯU TRỮ TẠM THỜI 24H ===\n');

  const prisma = new PrismaClient();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'agent-temp';

  try {
    // 1. Check Supabase connection
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: bucket, error } = await supabase.storage.getBucket(bucketName);
      if (error) {
        console.log(`[SUPABASE] Trạng thái: ⚠️ LỖI (${error.message})`);
      } else {
        console.log(`[SUPABASE] Trạng thái: ✅ ĐÃ KẾT NỐI (Bucket: "${bucketName}", Public: ${bucket?.public ? 'YES ⚠️' : 'NO ✅'})`);
      }
    } else {
      console.log(`[SUPABASE] Trạng thái: ℹ️ CHƯA CẤU HÌNH (Đang chạy chế độ Local Storage)`);
    }

    // 2. Query DB metrics
    const now = new Date();
    const activeCount = await prisma.storedFile.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
    });

    const expiredPendingCount = await prisma.storedFile.count({
      where: {
        status: { in: ['ACTIVE', 'DELETE_FAILED'] },
        expiresAt: { lte: now },
      },
    });

    const deletedCount = await prisma.storedFile.count({
      where: { status: 'DELETED' },
    });

    console.log(`\n[THỐNG KÊ TỆP TIN TẠM]:`);
    console.log(`  • Đang hoạt động (còn hạn < 24h): ${activeCount}`);
    console.log(`  • Đã quá hạn chờ xóa: ${expiredPendingCount}`);
    console.log(`  • Đã xóa thành công: ${deletedCount}`);

    const nextToExpire = await prisma.storedFile.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: 5,
    });

    if (nextToExpire.length > 0) {
      console.log(`\n[5 TỆP TIN SẮP HẾT HẠN SỚM NHẤT]:`);
      for (const f of nextToExpire) {
        const minsLeft = Math.round((f.expiresAt!.getTime() - now.getTime()) / (60 * 1000));
        console.log(`  • "${f.originalName}" (${f.provider}) -> Hết hạn sau ${minsLeft} phút (${f.expiresAt?.toLocaleTimeString('vi-VN')})`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkStorage();
