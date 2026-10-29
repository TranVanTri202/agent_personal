import { z } from 'zod';

export const ConfigSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  APP_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Zalo Official Bot
  ZALO_BOT_TOKEN: z.string().optional().default(''),
  ZALO_MODE: z.enum(['polling', 'webhook']).default('polling'),
  ZALO_POLL_TIMEOUT_SECONDS: z.coerce.number().default(30),
  ZALO_WEBHOOK_URL: z.string().optional().default(''),
  ZALO_WEBHOOK_SECRET: z.string().optional().default(''),
  ZALO_HTTP_TIMEOUT_MS: z.coerce.number().default(45000),
  ZALO_MAX_MESSAGE_LENGTH: z.coerce.number().default(2000),
  BOT_ACCESS_MODE: z.enum(['private', 'public']).default('private'),
  GROUP_ACCESS_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  ALLOWED_ZALO_USER_IDS: z.string().optional().default(''),

  // Database & Redis
  DATABASE_URL: z.string().default('postgresql://personal_agent:personal_agent_secret_pass@localhost:5433/personal_agent?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  WORKER_CONCURRENCY: z.coerce.number().default(1),

  // LLM / OpenRouter Gateway
  LLM_PROVIDER: z.enum(['openrouter', 'openai', 'mock']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_APP_NAME: z.string().default('My Zalo Personal Agent'),
  OPENROUTER_APP_URL: z.string().optional().default(''),

  // Routing Mode: "single" or "task"
  LLM_ROUTING_MODE: z.enum(['single', 'task']).default('single'),
  LLM_SINGLE_MODEL: z.string().default('openai/gpt-4o-mini'),
  LLM_DEFAULT_MODEL: z.string().default('openai/gpt-4o-mini'),

  // Task Routing Strategy
  LLM_TASK_ROUTING_STRATEGY: z.enum(['rules', 'adaptive']).default('rules'),
  LLM_TASK_ROUTING_CONFIG: z.string().default('./config/llm-routing.json'),

  // Execution Limits
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().default(60000),
  LLM_MAX_RETRIES: z.coerce.number().default(2),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(4096),
  LLM_MAX_STEPS: z.coerce.number().default(15),
  LLM_MAX_TOOL_CALLS: z.coerce.number().default(30),
  LLM_MAX_CONCURRENT_REQUESTS: z.coerce.number().default(3),

  // Cost & Privacy
  LLM_MAX_USD_PER_REQUEST: z.coerce.number().default(0.10),
  LLM_DAILY_BUDGET_USD: z.coerce.number().default(1.00),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().default(20.00),
  OPENROUTER_REQUIRE_ZDR: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  OPENROUTER_DENY_DATA_COLLECTION: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
  OPENROUTER_ALLOW_PROVIDER_FALLBACKS: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
  LLM_CROSS_MODEL_FALLBACK_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),

  // Model Catalog
  LLM_MODEL_CATALOG_CACHE_TTL_MINUTES: z.coerce.number().default(360),
  LLM_VALIDATE_MODEL_ON_STARTUP: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),

  // Audit
  LLM_LOG_PROMPT_CONTENT: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  LLM_LOG_TOOL_PAYLOAD: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  LLM_TRACK_USAGE: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),

  // Optional legacy fallbacks
  AI_PROVIDER: z.string().optional().default('openrouter'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default('gpt-4o-mini'),
  AI_MAX_STEPS: z.coerce.number().default(15),
  AI_MAX_TOOL_CALLS: z.coerce.number().default(30),
  AI_TASK_TIMEOUT_SECONDS: z.coerce.number().default(180),
  AI_DAILY_BUDGET_USD: z.coerce.number().default(2),

  // Storage
  STORAGE_PROVIDER: z.enum(['supabase', 'local', 'r2']).default('supabase'),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('agent-temp'),
  LOCAL_STORAGE_ROOT: z.string().default('./data'),
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  R2_ENDPOINT: z.string().optional().default(''),
  R2_PUBLIC_BASE_URL: z.string().optional().default(''),
  FILE_SIGNED_URL_TTL_SECONDS: z.coerce.number().default(900),

  // Google / Gmail
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/api/integrations/google/callback'),
  ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),

  // Optional tool tokens
  GITHUB_TOKEN: z.string().optional().default(''),
  WEB_SEARCH_API_KEY: z.string().optional().default(''),
  SPEECH_API_KEY: z.string().optional().default(''),
  IMAGE_API_KEY: z.string().optional().default(''),

  // Feature flags
  GMAIL_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  GITHUB_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  WEB_SEARCH_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  VOICE_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  ALLOW_EMAIL_AUTO_SEND: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export default (): AppConfig => {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.format());
    throw new Error('Environment variable validation failed');
  }
  return parsed.data;
};
