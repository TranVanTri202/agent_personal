export type LLMRoutingMode = 'single' | 'task';

export type LLMTaskCategory =
  | 'chat'
  | 'intent_classification'
  | 'planning'
  | 'tool_calling'
  | 'general_reasoning'
  | 'gmail_read'
  | 'gmail_summary'
  | 'gmail_draft'
  | 'document_summary'
  | 'document_extraction'
  | 'coding'
  | 'image_understanding'
  | 'translation';

export const ALL_TASK_CATEGORIES: LLMTaskCategory[] = [
  'chat',
  'intent_classification',
  'planning',
  'tool_calling',
  'general_reasoning',
  'gmail_read',
  'gmail_summary',
  'gmail_draft',
  'document_summary',
  'document_extraction',
  'coding',
  'image_understanding',
  'translation',
];

export interface LLMExecutionContext {
  taskId?: string;
  conversationId?: string;
  ownerId?: string;
  category: LLMTaskCategory;
  requiresTools?: boolean;
  requiresVision?: boolean;
  requiresStructuredOutput?: boolean;
  sensitivity?: 'normal' | 'sensitive';
  estimatedInputTokens?: number;
}

export interface ResolvedModel {
  modelId: string;
  mode: LLMRoutingMode;
  category: LLMTaskCategory;
  reason: string;
  capabilityVerified: boolean;
  requiresTools?: boolean;
  requiresVision?: boolean;
}
