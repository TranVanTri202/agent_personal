/**
 * Helper to split conversational LLM responses into natural, separate Zalo chat bubbles.
 * Prevents wide vertical spacing caused by bundling multi-paragraph answers into a single message.
 */
export function splitIntoChatMessages(text: string, maxMessages = 3): string[] {
  if (!text) return [];

  // Remove leading/trailing newlines and spaces
  let sanitized = text.trim();
  if (!sanitized) return [];

  // If text contains markdown code blocks (```), keep intact to preserve syntax formatting
  if (sanitized.includes('```')) {
    return [sanitized.replace(/\n{3,}/g, '\n\n')];
  }

  // Normalize excessive blank lines (3+ newlines -> 2 newlines)
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  // Split into raw paragraph blocks by double or more newlines
  const rawParagraphs = sanitized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (rawParagraphs.length <= 1) {
    return [sanitized];
  }

  const chunks: string[] = [];
  let current = '';

  for (let i = 0; i < rawParagraphs.length; i++) {
    const para = rawParagraphs[i];

    if (!current) {
      current = para;
      continue;
    }

    // Heuristics to keep blocks together in the same message:
    // 1. If previous block ends with a colon (e.g. "Dạ, chi tiết như sau:")
    const isIntroHeader = current.trim().endsWith(':');

    // 2. If current or next block is a list item and part of the same list
    const isCurrentList = /^[*\-•\d+.]\s+/m.test(current);
    const isNextList = /^[*\-•\d+.]\s+/m.test(para);
    const isListContinuation = isNextList && (isCurrentList || isIntroHeader);

    // 3. If combined length is very short (< 70 chars), avoid micro-messages
    const isVeryShort = current.length + para.length < 70;

    if (isIntroHeader || isListContinuation || isVeryShort) {
      current = `${current}\n\n${para}`;
    } else {
      chunks.push(current);
      current = para;
    }
  }

  if (current) {
    chunks.push(current);
  }

  // If number of chunks exceeds maxMessages, merge remaining tail into the last message
  if (chunks.length > maxMessages) {
    const head = chunks.slice(0, maxMessages - 1);
    const tail = chunks.slice(maxMessages - 1).join('\n\n');
    return [...head, tail];
  }

  return chunks;
}
