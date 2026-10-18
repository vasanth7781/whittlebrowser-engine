/**
 * Cheap token estimate used for budgeting (no tokenizer dependency at runtime). Calibrated against
 * o200k/cl100k on our snapshot format: ~3.6 chars per token for mixed English + refs + punctuation.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}
