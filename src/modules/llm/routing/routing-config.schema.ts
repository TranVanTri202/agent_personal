import { z } from 'zod';

export const TaskRoutingConfigSchema = z.object({
  version: z.number().default(1),
  strategy: z.enum(['rules', 'adaptive']).default('rules'),
  defaultModel: z.string().min(1),
  taskModels: z.record(z.string()).default({}),
  requirements: z.record(z.array(z.string())).default({
    tool_calling: ['tools'],
    image_understanding: ['image_input'],
    document_extraction: ['structured_output'],
  }),
  modelAllowlist: z.array(z.string()).default([]),
  modelDenylist: z.array(z.string()).default([]),
  adaptive: z
    .object({
      enabled: z.boolean().default(false),
      profile: z.enum(['economy', 'balanced', 'quality', 'latency']).default('balanced'),
      candidateModelsByTask: z.record(z.array(z.string())).default({}),
      qualityScoresSource: z.string().default('./config/model-evaluations.json'),
    })
    .default({
      enabled: false,
      profile: 'balanced',
      candidateModelsByTask: {},
      qualityScoresSource: './config/model-evaluations.json',
    }),
});

export type TaskRoutingConfig = z.infer<typeof TaskRoutingConfigSchema>;
