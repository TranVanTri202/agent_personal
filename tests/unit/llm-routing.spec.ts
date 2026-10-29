import { LLMRoutingService } from '../../src/modules/llm/routing/llm-routing.service';
import { ConfigService } from '@nestjs/config';
import { OpenRouterModelCatalogService } from '../../src/modules/llm/openrouter/openrouter.catalog';
import { AdaptiveSelectorService } from '../../src/modules/llm/routing/adaptive-selector.service';
import { AppLoggerService } from '../../src/common/logger/pino-logger.service';
import { LLMExecutionContext } from '../../src/modules/llm/routing/task-category';

describe('LLMRoutingService', () => {
  let mockConfigService: any;
  let mockCatalog: any;
  let mockAdaptiveSelector: any;
  let mockLogger: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'LLM_ROUTING_MODE') return 'single';
        if (key === 'LLM_SINGLE_MODEL') return 'anthropic/claude-3.5-sonnet';
        if (key === 'LLM_DEFAULT_MODEL') return 'openai/gpt-4o-mini';
        if (key === 'LLM_TASK_ROUTING_STRATEGY') return 'rules';
        if (key === 'LLM_TASK_ROUTING_CONFIG') return './config/llm-routing.json';
        return undefined;
      }),
    };

    mockCatalog = {
      supportsTools: jest.fn().mockResolvedValue(true),
      supportsVision: jest.fn().mockResolvedValue(true),
    };

    mockAdaptiveSelector = {
      loadEvaluationScores: jest.fn(),
      selectBestModel: jest.fn(),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('Single Mode', () => {
    it('should strictly return LLM_SINGLE_MODEL for every task category', async () => {
      const routingService = new LLMRoutingService(
        mockConfigService as unknown as ConfigService,
        mockCatalog as unknown as OpenRouterModelCatalogService,
        mockAdaptiveSelector as unknown as AdaptiveSelectorService,
        mockLogger as unknown as AppLoggerService,
      );
      routingService.onModuleInit();

      const categories: any[] = ['chat', 'coding', 'gmail_read', 'planning', 'translation'];
      for (const cat of categories) {
        const resolved = await routingService.resolveModel({ category: cat });
        expect(resolved.modelId).toBe('anthropic/claude-3.5-sonnet');
        expect(resolved.mode).toBe('single');
        expect(resolved.category).toBe(cat);
        expect(resolved.capabilityVerified).toBe(true);
      }
    });

    it('should flag capabilityVerified as false when single model lacks requested tool capability', async () => {
      mockCatalog.supportsTools.mockResolvedValue(false);

      const routingService = new LLMRoutingService(
        mockConfigService as unknown as ConfigService,
        mockCatalog as unknown as OpenRouterModelCatalogService,
        mockAdaptiveSelector as unknown as AdaptiveSelectorService,
        mockLogger as unknown as AppLoggerService,
      );
      routingService.onModuleInit();

      const resolved = await routingService.resolveModel({
        category: 'tool_calling',
        requiresTools: true,
      });

      expect(resolved.modelId).toBe('anthropic/claude-3.5-sonnet');
      expect(resolved.capabilityVerified).toBe(false);
      expect(resolved.reason).toContain('không hỗ trợ tool calling');
    });
  });

  describe('Task Mode', () => {
    let taskRoutingService: LLMRoutingService;

    beforeEach(() => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'LLM_ROUTING_MODE') return 'task';
        if (key === 'LLM_SINGLE_MODEL') return 'anthropic/claude-3.5-sonnet';
        if (key === 'LLM_DEFAULT_MODEL') return 'openai/gpt-4o-mini';
        if (key === 'LLM_TASK_ROUTING_STRATEGY') return 'rules';
        if (key === 'LLM_TASK_ROUTING_CONFIG') return './config/llm-routing.json';
        return undefined;
      });

      taskRoutingService = new LLMRoutingService(
        mockConfigService as unknown as ConfigService,
        mockCatalog as unknown as OpenRouterModelCatalogService,
        mockAdaptiveSelector as unknown as AdaptiveSelectorService,
        mockLogger as unknown as AppLoggerService,
      );
      taskRoutingService.onModuleInit();
    });

    it('should route category to configured model in rules strategy', async () => {
      const resolvedCoding = await taskRoutingService.resolveModel({ category: 'coding' });
      expect(resolvedCoding.mode).toBe('task');
      expect(resolvedCoding.modelId).toBeDefined();

      const resolvedChat = await taskRoutingService.resolveModel({ category: 'chat' });
      expect(resolvedChat.mode).toBe('task');
      expect(resolvedChat.modelId).toBeDefined();
    });

    it('should prioritize environment variable overrides LLM_TASK_MODEL_<CAT>', async () => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'LLM_ROUTING_MODE') return 'task';
        if (key === 'LLM_TASK_MODEL_CODING') return 'deepseek/deepseek-coder-override';
        return undefined;
      });

      const service = new LLMRoutingService(
        mockConfigService as unknown as ConfigService,
        mockCatalog as unknown as OpenRouterModelCatalogService,
        mockAdaptiveSelector as unknown as AdaptiveSelectorService,
        mockLogger as unknown as AppLoggerService,
      );
      service.onModuleInit();

      const resolved = await service.resolveModel({ category: 'coding' });
      expect(resolved.modelId).toBe('deepseek/deepseek-coder-override');
      expect(resolved.reason).toContain('LLM_TASK_MODEL_CODING');
    });
  });
});
