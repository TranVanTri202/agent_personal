export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface UnifiedLLMResponse {
  requestedModel: string;
  actualModel?: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  latencyMs?: number;
}

export type LLMResponse = UnifiedLLMResponse;

export interface LLMProvider {
  chat(messages: LLMMessage[], tools?: any[], modelOverride?: string): Promise<UnifiedLLMResponse>;
  isConfigured(): boolean;
}
