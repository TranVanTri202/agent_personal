import { Bot } from 'zalo-bot-js';

async function deleteWebhook() {
  const token = process.env.ZALO_BOT_TOKEN;

  if (!token) {
    console.error('❌ Lỗi: ZALO_BOT_TOKEN chưa được cấu hình');
    process.exit(1);
  }

  try {
    const bot = new Bot(token);
    const res = await bot.deleteWebhook();
    console.log('✅ Đã xóa Webhook thành công qua zalo-bot-js SDK (Bot sẵn sàng cho chế độ Long Polling):');
    console.log(JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error('❌ Lỗi khi xóa Webhook:', err.message || err);
  }
}

deleteWebhook();
