import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import axios from 'axios';

async function runDoctor() {
  console.log('🩺 === PERSONAL ZALO AI AGENT DOCTOR ===\n');

  // 1. Node version
  const nodeVersion = process.version;
  console.log(`[NODE] Version: ${nodeVersion} (${parseInt(nodeVersion.slice(1)) >= 20 ? '✅ Compatible' : '⚠️ Need Node >= 20'})`);

  // 2. PostgreSQL
  const dbUrl = process.env.DATABASE_URL || '';
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const userCount = await prisma.user.count();
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    console.log(`[POSTGRES] Connected successfully ✅`);
    console.log(`  • Database users: ${userCount}`);
    console.log(`  • Owner status: ${owner ? `Paired (Zalo ID: ${owner.zaloUserId})` : 'UNPAIRED (Run "npm run owner:pair-code")'}`);
  } catch (err: any) {
    console.error(`[POSTGRES] Connection failed ❌: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }

  // 3. Redis
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try {
    const pong = await redis.ping();
    console.log(`[REDIS] Connected successfully ✅ (PING: ${pong})`);
  } catch (err: any) {
    console.error(`[REDIS] Connection failed ❌: ${err.message}`);
  } finally {
    redis.disconnect();
  }

  // 4. Zalo Bot Token (via zalo-bot-js SDK)
  const zaloToken = process.env.ZALO_BOT_TOKEN;
  if (!zaloToken || zaloToken.trim().length === 0) {
    console.log(`[ZALO_BOT] Token: ⚠️ NOT_CONFIGURED (Please add fresh ZALO_BOT_TOKEN into .env)`);
  } else {
    try {
      const { Bot } = await import('zalo-bot-js');
      const bot = new Bot(zaloToken);
      const user = await bot.getMe();
      console.log(`[ZALO_BOT] Token is VALID (verified via zalo-bot-js SDK) ✅`);
      console.log(`  • Bot Name: ${user.displayName || user.accountName || 'Unknown'}`);
      console.log(`  • Bot ID: ${user.id || 'Unknown'}`);

      // Check webhook info
      const whInfo = await bot.getWebhookInfo();
      const whUrl = whInfo?.url;
      if (whUrl) {
        console.log(`  • Webhook active: ⚠️ YES (${whUrl}) -> If running polling mode, webhook must be deleted with "npm run zalo:webhook:delete"`);
      } else {
        console.log(`  • Webhook active: None (Ready for long polling) ✅`);
      }
    } catch (err: any) {
      console.error(`[ZALO_BOT] Token verification failed ❌: ${err.message}`);
    }
  }

  // 5. OpenRouter & LLM Routing
  const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  const routingMode = (process.env.LLM_ROUTING_MODE || 'single').toLowerCase();
  const singleModel = process.env.LLM_SINGLE_MODEL || 'anthropic/claude-3.5-sonnet';
  const defaultModel = process.env.LLM_DEFAULT_MODEL || 'openai/gpt-4o-mini';
  const taskStrategy = process.env.LLM_TASK_ROUTING_STRATEGY || 'rules';

  if (!openrouterKey || openrouterKey.trim().length === 0) {
    console.log(`[LLM_GATEWAY] Provider: OpenRouter (API Key: ⚠️ NOT_CONFIGURED - Mock LLM Provider will be used)`);
  } else {
    console.log(`[LLM_GATEWAY] Provider: OpenRouter (API Key: CONFIGURED ✅)`);
    try {
      const res = await axios.get('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${openrouterKey}` },
        timeout: 5000,
      });
      const data = res.data?.data;
      if (data) {
        console.log(`  • Key Label: ${data.label || 'Default'}`);
        console.log(`  • Usage: $${data.usage?.toFixed(4) || 0} / Limit: ${data.limit ? `$${data.limit}` : 'Unlimited'}`);
      }
    } catch {
      // Key auth endpoint might fail or timeout, don't fail whole doctor
      console.log(`  • Key verification: Live check skipped or endpoint unavailable`);
    }
  }
  console.log(`  • Routing Mode: ${routingMode.toUpperCase()}`);
  if (routingMode === 'single') {
    console.log(`  • Single Model: ${singleModel} (100% tasks bypass mapping)`);
  } else {
    console.log(`  • Task Strategy: ${taskStrategy}`);
    console.log(`  • Default Fallback Model: ${defaultModel}`);
    const fs = await import('fs');
    const path = await import('path');
    const routingConfigPath = process.env.LLM_TASK_ROUTING_CONFIG || path.resolve(process.cwd(), 'config/llm-routing.json');
    if (fs.existsSync(routingConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(routingConfigPath, 'utf8'));
        const catCount = Object.keys(raw.categories || {}).length;
        console.log(`  • Routing Config: ${routingConfigPath} ✅ (${catCount} categories defined)`);
      } catch (err: any) {
        console.log(`  • Routing Config: ⚠️ Invalid JSON in ${routingConfigPath}: ${err.message}`);
      }
    } else {
      console.log(`  • Routing Config: ⚠️ File not found at ${routingConfigPath}`);
    }
  }

  // 6. Storage Provider (Supabase Temporary Storage 24h)
  const storageProvider = process.env.STORAGE_PROVIDER || 'supabase';
  console.log(`[STORAGE] Provider: ${storageProvider.toUpperCase()}`);
  if (storageProvider === 'supabase') {
    const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log(`  • Supabase Storage (24h TTL): ${supabaseConfigured ? 'Configured ✅' : 'Not configured (Run "npm run storage:setup") ⚠️'}`);
    console.log(`  • Bucket: ${process.env.SUPABASE_STORAGE_BUCKET || 'agent-temp'} (Private)`);
  } else if (storageProvider === 'r2') {
    const r2Configured = Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
    console.log(`  • Cloudflare R2 (Legacy): ${r2Configured ? 'Configured ✅' : 'Incomplete credentials ⚠️'}`);
  } else {
    console.log(`  • Local Storage root: ${process.env.LOCAL_STORAGE_ROOT || './data'} ✅`);
  }

  // 7. Google OAuth / Gmail
  const gmailEnabled = process.env.GMAIL_ENABLED === 'true';
  console.log(`[GMAIL] Feature enabled: ${gmailEnabled ? 'YES' : 'NO'}`);
  if (gmailEnabled) {
    const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    console.log(`  • OAuth Client: ${oauthConfigured ? 'Configured ✅' : 'Missing GOOGLE_CLIENT_ID or SECRET ⚠️'}`);
  }

  console.log('\n🩺 === DOCTOR CHECK COMPLETE ===\n');
}

runDoctor().catch(console.error);
