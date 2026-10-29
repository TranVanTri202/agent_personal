import * as dotenv from 'dotenv';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const specifiedModel = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : null;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = specifiedModel || process.env.OPENROUTER_IMAGE_MODEL || 'qwen/qwen-image-2.1-turbo';

  console.log('🎨 === OPENROUTER IMAGE GENERATION LIVE SMOKE TEST ===\n');
  console.log('⚠️  CẢNH BÁO: Lệnh này sẽ gọi trực tiếp đến OpenRouter Image API thật.');
  console.log('   Việc này có thể tiêu tốn OpenRouter credits thực tế từ tài khoản của bạn.');
  console.log(`   Model đang thử nghiệm: "${model}"\n`);

  if (!apiKey || apiKey.trim().length === 0) {
    console.error('❌ Không tìm thấy OPENROUTER_API_KEY trong file .env.');
    process.exit(1);
  }

  // 1. Check capability
  console.log(`1️⃣ Đang kiểm tra danh mục image models từ OpenRouter...`);
  try {
    const modelsRes = await axios.get('https://openrouter.ai/api/v1/images/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    const catalog = modelsRes.data?.data || [];
    const modelInfo = catalog.find((m: any) => m.id?.toLowerCase() === model.toLowerCase());
    if (modelInfo) {
      console.log(`   ✅ Model "${model}" có trên OpenRouter.`);
      console.log(`   Supported params:`, Object.keys(modelInfo.supported_parameters || {}));
    } else {
      console.log(`   ⚠️ Model "${model}" không tìm thấy trong catalog /images/models, nhưng vẫn sẽ thử gọi.`);
    }
  } catch (err: any) {
    console.warn(`   ⚠️ Không thể lấy catalog model (${err.message}). Bỏ qua bước kiểm tra.`);
  }

  // 2. Call /api/v1/images
  console.log(`\n2️⃣ Đang gửi request tạo ảnh tới OpenRouter Image API (${model})...`);
  const prompt = 'A cute little chibi robot holding a cup of hot coffee, clean pastel background';
  const startTime = Date.now();

  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/images',
      {
        model,
        prompt,
        aspect_ratio: '1:1',
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PersonalZaloAgent/1.0',
        },
        timeout: 90000,
      },
    );

    const latency = Date.now() - startTime;
    const items = res.data?.data || [];
    const cost = res.data?.usage?.cost;

    console.log(`   ✅ Tạo ảnh thành công trong ${latency}ms!`);
    console.log(`   • Số ảnh trả về: ${items.length}`);
    console.log(`   • Chi phí ước tính: $${cost ?? 'N/A'}`);

    if (items.length > 0) {
      const first = items[0];
      const outDir = path.resolve(process.cwd(), 'data', 'smoke-test');
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const outPath = path.join(outDir, `smoke-${Date.now()}.png`);
      if (first.b64_json) {
        fs.writeFileSync(outPath, Buffer.from(first.b64_json, 'base64'));
        console.log(`   • Đã lưu ảnh kiểm tra tại: ${outPath}`);
      } else if (first.url) {
        console.log(`   • Link ảnh trả về: ${first.url}`);
      }
    }

    console.log('\n🎉 SMOKE TEST IMAGE GENERATION HOÀN TOÀN THÀNH CÔNG!');
  } catch (err: any) {
    const latency = Date.now() - startTime;
    console.error(`\n❌ Gọi tạo ảnh thất bại sau ${latency}ms:`);
    if (err.response) {
      console.error(`   • HTTP Status: ${err.response.status}`);
      console.error(`   • Chi tiết lỗi:`, JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(`   • Lỗi: ${err.message}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
