/**
 * Extractive digest of a page's main content (markdown from the in-page reader) within a token budget:
 * title, then each heading with the first lines under it, then remaining lines in order. Used by
 * research mode so the model can compare many pages without reading any of them in full.
 */
import { estimateTokens } from './tokens.js';

export function digest(md: string, budget: number): string {
  const lines = md.split('\n').map((l) => (l.length > 280 ? l.slice(0, 279) + '…' : l)).filter((l) => l.trim());
  const picked = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    if (picked.has(i)) return true;
    const c = estimateTokens(lines[i]) + 1;
    if (used + c > budget) return false;
    picked.add(i);
    used += c;
    return true;
  };
  // Pass 1: headings plus the first two body lines under each.
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{1,6} /.test(lines[i])) continue;
    if (!take(i)) break;
    let body = 0;
    for (let j = i + 1; j < lines.length && body < 2 && !/^#{1,6} /.test(lines[j]); j++, body++) if (!take(j)) break;
  }
  // Pass 2: fill with the remaining lines in reading order.
  for (let i = 0; i < lines.length && used < budget; i++) take(i);
  const out = [...picked].sort((a, b) => a - b).map((i) => lines[i]);
  const dropped = lines.length - picked.size;
  return out.join('\n') + (dropped > 0 ? `\n… (${dropped} more lines)` : '');
}
