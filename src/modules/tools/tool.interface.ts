export interface ToolExecutionContext {
  ownerId: string;
  taskId?: string;
  conversationId?: string;
  chatId: string;
  chatType?: 'PRIVATE' | 'GROUP';
  channel?: string;
  abortSignal?: AbortSignal;
}

export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresApproval(input: TInput): boolean;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
