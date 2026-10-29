import * as dotenv from 'dotenv';
import axios from 'axios';
import { KNOWN_MODELS_FALLBACK } from '../src/modules/llm/openrouter/openrouter.catalog';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const filterTools = args.includes('--tools');
  const filterVision = args.includes('--vision');
  const searchArgIdx = args.indexOf('--search');
  const search = searchArgIdx !== -1 && args[searchArgIdx + 1] ? args[searchArgIdx + 1].toLowerCase() : null;

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

  console.log('📋 === OPENROUTER MODEL LIST ===\n');

  let models: Array<{ id: string; name?: string; supportsTools: boolean; supportsVision: boolean; contextLength?: number }> = [];

  if (apiKey && apiKey.trim().length > 0) {
    try {
      console.log('Connecting to OpenRouter /api/v1/models...');
      const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      const data = res.data?.data || [];
      for (const item of data) {
        const params = item.supported_parameters || [];
        const supportsTools = params.includes('tools') || params.includes('function_calling');
        const architecture = item.architecture || {};
        const modality = architecture.modality || '';
        const supportsVision = modality.includes('image') || modality.includes('multimodal');
        models.push({
          id: item.id,
          name: item.name,
          supportsTools,
          supportsVision,
          contextLength: item.context_length,
        });
      }
    } catch (err: any) {
      console.warn(`Could not fetch live models: ${err.message}. Showing built-in fallback catalog.`);
    }
  }

  if (models.length === 0) {
    console.log('Displaying built-in fallback catalog:\n');
    models = Object.values(KNOWN_MODELS_FALLBACK).map((m) => {
      const params = m.supported_parameters || [];
      const supportsTools = params.includes('tools') || params.includes('tool_choice');
      const modality = m.architecture?.modality || '';
      const supportsVision = modality.includes('image');
      return {
        id: m.id || 'unknown',
        name: m.name,
        supportsTools,
        supportsVision,
        contextLength: m.context_length,
      };
    });
  }

  // Filter
  if (filterTools) {
    models = models.filter((m) => m.supportsTools);
  }
  if (filterVision) {
    models = models.filter((m) => m.supportsVision);
  }
  if (search) {
    models = models.filter((m) => m.id.toLowerCase().includes(search) || (m.name && m.name.toLowerCase().includes(search)));
  }

  console.log(
    'MODEL ID'.padEnd(40) +
    'TOOLS'.padEnd(8) +
    'VISION'.padEnd(8) +
    'CTX LENGTH'
  );
  console.log('-'.repeat(70));

  for (const m of models) {
    console.log(
      m.id.padEnd(40) +
      (m.supportsTools ? '✅' : '❌').padEnd(8) +
      (m.supportsVision ? '✅' : '❌').padEnd(8) +
      (m.contextLength ? `${m.contextLength.toLocaleString()}` : '-')
    );
  }
}

main().catch(console.error);
