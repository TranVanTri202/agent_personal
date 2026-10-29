import { Bot } from 'zalo-bot-js';

async function testZaloBot() {
  const token = process.env.ZALO_BOT_TOKEN;
  if (!token) {
    console.error('❌ Lỗi: ZALO_BOT_TOKEN chưa được điền trong file .env');
    process.exit(1);
  }

  console.log('🔄 Đang kiểm tra Zalo Bot token với SDK zalo-bot-js...');

  try {
    const bot = new Bot(token);
    const user = await bot.getMe();
    console.log('✅ KẾT QUẢ XÁC THỰC THÀNH CÔNG VỚI zalo-bot-js SDK:');
    console.log(JSON.stringify(user, null, 2));
  } catch (err: any) {
    console.error('❌ Lỗi kết nối hoặc token không hợp lệ:');
    console.error(err.message || err);
    process.exit(1);
  }
}

testZaloBot();
