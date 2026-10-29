import { z } from 'zod';

export const STICKER_EMOTIONS = [
  'hello',
  'happy',
  'funny',
  'thanks',
  'sorry',
  'celebrate',
  'encourage',
  'love',
  'surprised',
  'thinking',
  'goodbye',
] as const;

export type StickerEmotion = (typeof STICKER_EMOTIONS)[number];

export const StickerGroupSchema = z
  .array(z.string().transform((s) => s.trim()))
  .transform((items) => Array.from(new Set(items.filter((id) => id.length > 0))));

export const StickersConfigSchema = z
  .record(z.string(), StickerGroupSchema)
  .transform((data) => {
    const sanitized: Record<StickerEmotion, string[]> = {
      hello: [],
      happy: [],
      funny: [],
      thanks: [],
      sorry: [],
      celebrate: [],
      encourage: [],
      love: [],
      surprised: [],
      thinking: [],
      goodbye: [],
    };

    for (const emotion of STICKER_EMOTIONS) {
      if (Array.isArray(data[emotion])) {
        sanitized[emotion] = data[emotion];
      }
    }

    return sanitized;
  });

export type StickersConfig = z.infer<typeof StickersConfigSchema>;
