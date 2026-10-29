import { Bot } from 'zalo-bot-js';

async function setWebhook() {
  const token = process.env.ZALO_BOT_TOKEN;
  const webhookUrl = process.env.ZALO_WEBHOOK_URL;
  const secretToken = process.env.ZALO_WEBHOOK_SECRET;

  if (!token) {
    console.error('❌ Lỗi: ZALO_BOT_TOKEN chưa được cấu hình');
    process.exit(1);
  }

  if (!webhookUrl || !secretToken) {
    console.error('❌ Lỗi: Cần cấu hình ZALO_WEBHOOK_URL và ZALO_WEBHOOK_SECRET trong .env');
    process.exit(1);
  }

  try {
    const bot = new Bot(token);
    const res = await bot.setWebhook(webhookUrl, secretToken);
    console.log('✅ Đã thiết lập Webhook thành công (qua zalo-bot-js SDK):');
    console.log(JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error('❌ Lỗi khi thiết lập Webhook:', err.message || err);
  }
}

setWebhook();
