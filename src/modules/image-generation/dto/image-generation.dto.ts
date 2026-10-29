import { z } from 'zod';

export const GenerateImageSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(2000, 'Prompt too long'),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  count: z.number().int().min(1).max(4).optional(),
  style: z.string().optional(),
});

export type GenerateImageDto = z.infer<typeof GenerateImageSchema>;

export const EditImageSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(2000, 'Prompt too long'),
  sourceFileId: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  count: z.number().int().min(1).max(4).optional(),
});

export type EditImageDto = z.infer<typeof EditImageSchema>;

export interface ImageGenerationResult {
  success: boolean;
  fileId?: string;
  imageId?: string;
  url?: string;
  localPath?: string;
  storagePath?: string;
  mimeType?: string;
  costUsd?: number | null;
  modelId: string;
  actionType: 'generate' | 'edit';
  prompt: string;
  error?: string;
  warning?: string;
}

export interface ImageModelInfo {
  id: string;
  name: string;
  description?: string;
  supportedParameters: Record<string, any>;
  supportsInputReferences: boolean;
  maxInputReferences?: number;
}
