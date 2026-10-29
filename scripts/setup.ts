import { execSync } from 'child_process';
import * as fs from 'fs';

async function setup() {
  console.log('🚀 === KHỞI TẠO DỰ ÁN PERSONAL ZALO AI AGENT ===\n');

  if (!fs.existsSync('.env')) {
    console.log('1. Copying .env.example to .env...');
    fs.copyFileSync('.env.example', '.env');
    console.log('   ✅ Đã tạo file .env. Vui lòng cập nhật các biến bí mật khi cần.');
  }

  console.log('2. Kiểm tra Prisma Client & migrations...');
  execSync('npx prisma generate', { stdio: 'inherit' });
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  console.log('3. Chạy seed cơ sở dữ liệu...');
  execSync('npx ts-node -r dotenv/config prisma/seed.ts', { stdio: 'inherit' });

  console.log('\n✅ SETUP HOÀN TẤT!');
  console.log('Các bước tiếp theo:');
  console.log('• Kiểm tra hệ thống: npm run doctor');
  console.log('• Tạo mã ghép nối chủ sở hữu: npm run owner:pair-code');
  console.log('• Khởi động HTTP API: npm run dev');
  console.log('• Khởi động Worker & Poller: npm run dev:worker');
}

setup().catch(console.error);
