import { createClient } from '@supabase/supabase-js';

async function setupStorage() {
  console.log('📦 === SUPABASE TEMPORARY STORAGE SETUP ===\n');

  let supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (supabaseUrl) {
    supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/storage\/v1\/?$/, '').replace(/\/+$/, '');
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'agent-temp';

  if (!supabaseUrl || !serviceKey) {
    console.log('⚠️ SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình trong .env.');
    console.log('\n📝 HƯỚNG DẪN CẤU HÌNH SUPABASE STORAGE:');
    console.log('1. Đăng ký tài khoản miễn phí tại: https://supabase.com');
    console.log('2. Tạo project mới (ví dụ: personal-agent-storage). Lưu ý: Không cần dùng Supabase Database cho NestJS.');
    console.log('3. Vào Storage > New bucket:');
    console.log(`   • Tên bucket: ${bucketName}`);
    console.log('   • Public bucket: TẮT (Private bucket)');
    console.log('4. Vào Project Settings > API:');
    console.log('   • Copy "Project URL" dán vào SUPABASE_URL');
    console.log('   • Copy "service_role" secret key dán vào SUPABASE_SERVICE_ROLE_KEY');
    console.log('5. Lưu file .env và chạy lại: npm run storage:setup\n');
    return;
  }

  console.log(`• Supabase URL: ${supabaseUrl}`);
  console.log(`• Bucket mục tiêu: ${bucketName} (Private)`);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      console.error(`❌ Không thể kết nối tới Supabase Storage: ${listErr.message}`);
      return;
    }

    const existing = buckets?.find((b) => b.name === bucketName);
    if (existing) {
      console.log(`✅ Bucket "${bucketName}" đã tồn tại trên Supabase Storage!`);
      console.log(`   - Public: ${existing.public ? '⚠️ CẢNH BÁO: ĐANG BẬT PUBLIC (Nên đổi sang Private trong Dashboard)' : '✅ PRIVATE (Đúng chuẩn bảo mật)'}`);
      console.log('\n🎉 Supabase Storage đã sẵn sàng hoạt động với thời hạn tự động xóa 24 giờ cho từng file!');
      return;
    }

    console.log(`⏳ Đang tạo bucket "${bucketName}" (Private)...`);
    const { error: createErr } = await supabase.storage.createBucket(bucketName, {
      public: false,
    });

    if (createErr) {
      console.error(`⚠️ Không thể tự động tạo bucket: ${createErr.message}`);
      console.log(`👉 Bạn vui lòng vào Supabase Dashboard > Storage > Create bucket "${bucketName}" với chế độ Private.`);
      return;
    }

    console.log(`✅ Đã tạo thành công private bucket "${bucketName}" trên Supabase Storage!`);
  } catch (err: any) {
    console.error(`❌ Lỗi ngoại lệ: ${err.message}`);
  }
}

setupStorage();
