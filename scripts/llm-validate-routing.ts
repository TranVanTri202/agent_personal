import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { TaskRoutingConfigSchema } from '../src/modules/llm/routing/routing-config.schema';
import { ALL_TASK_CATEGORIES, LLMTaskCategory } from '../src/modules/llm/routing/task-category';
import { KNOWN_MODELS_FALLBACK, OpenRouterModelInfo } from '../src/modules/llm/openrouter/openrouter.catalog';
import axios from 'axios';

dotenv.config();

interface ModelInfo {
  id: string;
  supportsTools: boolean;
  supportsVision: boolean;
}

async function fetchOpenRouterCatalog(apiKey?: string): Promise<Map<string, ModelInfo>> {
  const catalog = new Map<string, ModelInfo>();

  // Populate from local fallback catalog first
  for (const [id, m] of Object.entries(KNOWN_MODELS_FALLBACK)) {
    const params = m.supported_parameters || [];
    const supportsTools = params.includes('tools') || params.includes('tool_choice');
    const modality = m.architecture?.modality || '';
    const supportsVision = modality.includes('image');
    catalog.set(id, { id, supportsTools, supportsVision });
  }

  // If API key is available, fetch live models list from OpenRouter
  if (apiKey && apiKey.trim().length > 0) {
    try {
      console.log('🌐 Fetching live model catalog from OpenRouter...');
      const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      const data = res.data?.data;
      if (Array.isArray(data)) {
        for (const item of data) {
          const id = item.id;
          const params = item.supported_parameters || [];
          const supportsTools = params.includes('tools') || params.includes('function_calling');
          const architecture = item.architecture || {};
          const modality = architecture.modality || '';
          const supportsVision = modality.includes('image') || modality.includes('multimodal');
          catalog.set(id, { id, supportsTools, supportsVision });
        }
        console.log(`✅ Loaded ${data.length} live models from OpenRouter.`);
      }
    } catch (err: any) {
      console.warn(`⚠️ Could not reach OpenRouter live models endpoint: ${err.message}. Using built-in catalog.`);
    }
  }

  return catalog;
}

async function main() {
  console.log('🔍 === VALIDATING OPENROUTER & LLM ROUTING CONFIGURATION ===\n');

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  const singleModel = process.env.LLM_SINGLE_MODEL || 'anthropic/claude-3.5-sonnet';
  const defaultModel = process.env.LLM_DEFAULT_MODEL || 'openai/gpt-4o-mini';
  const configPath = process.env.LLM_TASK_ROUTING_CONFIG || path.resolve(process.cwd(), 'config/llm-routing.json');

  const catalog = await fetchOpenRouterCatalog(apiKey);
  let hasErrors = false;

  console.log(`\n1. Checking Single Mode Configuration:`);
  console.log(`  • Configured Single Model: ${singleModel}`);
  const singleModelInfo = catalog.get(singleModel);
  if (!singleModelInfo) {
    console.warn(`  ⚠️ Model "${singleModel}" is not in the known local catalog (may still be valid on OpenRouter).`);
  } else {
    console.log(`  • Capabilities: Tools=${singleModelInfo.supportsTools ? '✅' : '❌'}, Vision=${singleModelInfo.supportsVision ? '✅' : '❌'}`);
    if (!singleModelInfo.supportsTools) {
      console.warn(`  ⚠️ Warning: "${singleModel}" does not indicate tool calling support. Tool calls in single mode will throw a capability error.`);
    }
  }

  console.log(`\n2. Checking Task Routing Config File (${configPath}):`);
  if (!fs.existsSync(configPath)) {
    console.error(`  ❌ Configuration file does not exist: ${configPath}`);
    process.exit(1);
  }

  let rawJson: any;
  try {
    rawJson = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err: any) {
    console.error(`  ❌ Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  const parseResult = TaskRoutingConfigSchema.safeParse(rawJson);
  if (!parseResult.success) {
    console.error(`  ❌ Schema validation failed:`);
    for (const issue of parseResult.error.issues) {
      console.error(`    • Path: ${issue.path.join('.')} - ${issue.message}`);
    }
    hasErrors = true;
  } else {
    console.log(`  ✅ Schema is strictly valid.`);
    const validConfig = parseResult.data;

    console.log(`\n3. Checking Task Categories & Model Capabilities:`);
    const taskModels = validConfig.taskModels || {};
    const configuredCategories = Object.keys(taskModels);
    console.log(`  • Configured categories: ${configuredCategories.length} / ${ALL_TASK_CATEGORIES.length}`);

    for (const cat of ALL_TASK_CATEGORIES) {
      const modelId = taskModels[cat] || validConfig.defaultModel || defaultModel;
      const modelInfo = catalog.get(modelId);
      const requirements = validConfig.requirements[cat] || [];
      const requiresTools = requirements.includes('tools') || cat === 'tool_calling';
      const requiresVision = requirements.includes('image_input') || cat === 'image_understanding';

      const statusParts: string[] = [];
      if (!modelInfo) {
        statusParts.push(`⚠️ unknown to local catalog`);
      } else {
        if (requiresTools && !modelInfo.supportsTools) {
          statusParts.push(`❌ requires tools but model lacks tools`);
          hasErrors = true;
        }
        if (requiresVision && !modelInfo.supportsVision) {
          statusParts.push(`❌ requires vision but model lacks vision`);
          hasErrors = true;
        }
      }

      const statusStr = statusParts.length > 0 ? `(${statusParts.join(', ')})` : '✅';
      console.log(`  • [${cat}] -> ${modelId} ${statusStr}`);
    }
  }

  console.log('\n======================================================');
  if (hasErrors) {
    console.error('❌ Validation completed with ERRORS. Please fix configuration before running in production.');
    process.exit(1);
  } else {
    console.log('✅ Validation PASSED! LLM Routing and Model mappings are healthy.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unexpected validation failure:', err);
  process.exit(1);
});
