import { Bot } from 'zalo-bot-js';

async function getWebhookInfo() {
  const token = process.env.ZALO_BOT_TOKEN;
  if (!token) {
    console.error('❌ Lỗi: ZALO_BOT_TOKEN chưa được cấu hình');
    process.exit(1);
  }

  try {
    const bot = new Bot(token);
    const info = await bot.getWebhookInfo();
    console.log('Thông tin Webhook hiện tại (qua zalo-bot-js SDK):');
    console.log(JSON.stringify(info, null, 2));
  } catch (err: any) {
    console.error('Lỗi khi lấy thông tin Webhook:', err.message || err);
  }
}

getWebhookInfo();
