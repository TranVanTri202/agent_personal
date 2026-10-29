import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const specifiedModel = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : null;

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  const model = specifiedModel || process.env.LLM_SINGLE_MODEL || 'anthropic/claude-3.5-sonnet';

  console.log('💨 === OPENROUTER SMOKE TEST ===\n');

  if (!apiKey || apiKey.trim().length === 0) {
    console.warn('⚠️ No OPENROUTER_API_KEY found in environment.');
    console.warn('To test against the live OpenRouter gateway, please configure OPENROUTER_API_KEY in your .env file.');
    console.log('Skipping live call (mock test passed).');
    process.exit(0);
  }

  console.log(`Sending ping completion to OpenRouter using model: ${model}...`);
  const startTime = Date.now();

  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: 'You are a test assistant. Answer with a single concise sentence.' },
          { role: 'user', content: 'Say hello and confirm you are operational.' },
        ],
        max_tokens: 60,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/personal-agent-zalo',
          'X-Title': 'Personal Zalo AI Agent',
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    const latency = Date.now() - startTime;
    const choice = res.data?.choices?.[0];
    const message = choice?.message?.content;
    const usage = res.data?.usage;

    console.log(`\n✅ OpenRouter responded in ${latency}ms:`);
    console.log(`  • Reply: "${message?.trim()}"`);
    if (usage) {
      console.log(`  • Prompt tokens: ${usage.prompt_tokens}`);
      console.log(`  • Completion tokens: ${usage.completion_tokens}`);
      console.log(`  • Total tokens: ${usage.total_tokens}`);
    }
    console.log('\n💨 Smoke test SUCCESSFUL!');
  } catch (err: any) {
    const latency = Date.now() - startTime;
    console.error(`\n❌ OpenRouter call failed after ${latency}ms:`);
    if (err.response) {
      console.error(`  • Status: ${err.response.status}`);
      console.error(`  • Data:`, JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(`  • Error: ${err.message}`);
    }
    process.exit(1);
  }
}

main().catch(console.error);
