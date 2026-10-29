import { OpenRouterGateway } from '../../src/modules/llm/openrouter/openrouter.gateway';
import { ConfigService } from '@nestjs/config';
import { OpenRouterClientProvider } from '../../src/modules/llm/openrouter/openrouter.client';
import { OpenRouterModelCatalogService } from '../../src/modules/llm/openrouter/openrouter.catalog';
import { OpenRouterUsageService } from '../../src/modules/llm/openrouter/openrouter.usage';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';
import { OpenRouterCapabilityError } from '../../src/modules/llm/openrouter/openrouter.error-mapper';
import { ResolvedModel } from '../../src/modules/llm/routing/task-category';

describe('OpenRouterGateway', () => {
  let gateway: OpenRouterGateway;
  let mockConfigService: any;
  let mockClientProvider: any;
  let mockCatalog: any;
  let mockUsageService: any;
  let mockLogger: any;
  let mockOpenAIClient: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'LLM_MAX_RETRIES') return 1;
        if (key === 'LLM_MAX_OUTPUT_TOKENS') return 2048;
        if (key === 'OPENROUTER_ALLOW_PROVIDER_FALLBACKS') return true;
        if (key === 'OPENROUTER_DENY_DATA_COLLECTION') return true;
        return undefined;
      }),
    };

    mockOpenAIClient = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    mockClientProvider = {
      isConfigured: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(mockOpenAIClient),
    };

    mockCatalog = {
      supportsTools: jest.fn().mockResolvedValue(true),
      supportsVision: jest.fn().mockResolvedValue(true),
    };

    mockUsageService = {
      checkBudgetBeforeRequest: jest.fn().mockResolvedValue(undefined),
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    gateway = new OpenRouterGateway(
      mockConfigService as unknown as ConfigService,
      mockClientProvider as unknown as OpenRouterClientProvider,
      mockCatalog as unknown as OpenRouterModelCatalogService,
      mockUsageService as unknown as OpenRouterUsageService,
      mockLogger as unknown as AppLoggerService,
    );
  });

  const sampleResolved: ResolvedModel = {
    modelId: 'openai/gpt-4o-mini',
    mode: 'single',
    category: 'chat',
    reason: 'Single mode test',
    capabilityVerified: true,
  };

  it('should throw if client is not configured', async () => {
    mockClientProvider.isConfigured.mockReturnValue(false);

    await expect(
      gateway.execute([{ role: 'user', content: 'hello' }], undefined, sampleResolved),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in .env');
  });

  it('should throw OpenRouterCapabilityError if tools are provided but model lacks tools', async () => {
    mockCatalog.supportsTools.mockResolvedValue(false);

    const tools = [{ type: 'function', function: { name: 'test_tool', parameters: {} } }];

    await expect(
      gateway.execute([{ role: 'user', content: 'test' }], tools, sampleResolved),
    ).rejects.toThrow(OpenRouterCapabilityError);
  });

  it('should throw OpenRouterCapabilityError if vision is required but model lacks vision', async () => {
    mockCatalog.supportsVision.mockResolvedValue(false);

    await expect(
      gateway.execute([{ role: 'user', content: 'test' }], undefined, sampleResolved, {
        category: 'image_understanding',
        requiresVision: true,
      }),
    ).rejects.toThrow(OpenRouterCapabilityError);
  });

  it('should execute chat completion and parse tool calls successfully', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue({
      id: 'gen-123',
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'zalo_send_message',
                  arguments: JSON.stringify({ message: 'Hello from tool' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
        cost: 0.00002,
      },
    });

    const result = await gateway.execute(
      [{ role: 'user', content: 'Gửi tin nhắn' }],
      [{ type: 'function', function: { name: 'zalo_send_message' } }],
      sampleResolved,
    );

    expect(result.actualModel).toBe('openai/gpt-4o-mini');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('zalo_send_message');
    expect(result.toolCalls[0].arguments).toEqual({ message: 'Hello from tool' });
    expect(result.usage?.totalTokens).toBe(40);
    expect(mockUsageService.recordUsage).toHaveBeenCalledTimes(1);
  });
});
