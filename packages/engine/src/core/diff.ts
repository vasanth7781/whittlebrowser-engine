/**
 * Observation diffs: after an action the model gets only what changed, with the nearest structural
 * line (form, dialog, heading, landmark) as context. Lines carrying the same ref that changed are shown
 * once with "~" instead of a remove/add pair.
 */
import type { Line } from './serialize.js';
import { estimateTokens } from './tokens.js';

type Op = { k: '=' | '+' | '-'; a?: number; b?: number };

/** Myers O(ND) line diff. Returns null if the edit distance exceeds maxD (caller sends a full view). */
export function diffSeq(a: string[], b: string[], maxD = 600): Op[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const N = A.length, M = B.length;
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: '=', a: i, b: i });
  const mid: Op[] = [];
  if (N === 0) for (let j = 0; j < M; j++) mid.push({ k: '+', b: pre + j });
  else if (M === 0) for (let i = 0; i < N; i++) mid.push({ k: '-', a: pre + i });
  else {
    const max = N + M;
    const off = max;
    const v = new Int32Array(2 * max + 2);
    const trace: Int32Array[] = [];
    let found = false;
    for (let d = 0; d <= Math.min(max, maxD); d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= N && y >= M) { found = true; break; }
      }
      if (found) {
        trace.push(v.slice());
        break;
      }
    }
    if (!found) return null;
    // Backtrack.
    let x = N, y = M;
    for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
      const vv = trace[d];
      const k = x - y;
      const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
      const px = vv[off + prevK];
      const py = px - prevK;
      while (x > px && y > py) { mid.push({ k: '=', a: pre + x - 1, b: pre + y - 1 }); x--; y--; }
      if (d > 0) {
        if (x === px) { mid.push({ k: '+', b: pre + y - 1 }); y--; }
        else { mid.push({ k: '-', a: pre + x - 1 }); x--; }
      }
    }
    while (x > 0 && y > 0) { mid.push({ k: '=', a: pre + x - 1, b: pre + y - 1 }); x--; y--; }
    mid.reverse();
  }
  ops.push(...mid);
  for (let i = 0; i < suf; i++) ops.push({ k: '=', a: a.length - suf + i, b: b.length - suf + i });
  return ops;
}

export interface DiffResult {
  text: string;
  added: number;
  removed: number;
  changed: number;
  tokens: number;
}

const key = (l: Line) => ' '.repeat(l.d) + l.t;

/**
 * Format a diff between two renders. Returns null when a diff would not be cheaper than a full view
 * (the caller then sends the full observation).
 */
export function diffLines(prev: Line[], next: Line[], fullTokens: number, maxTokens = 1500): DiffResult | null {
  const a = prev.map(key), b = next.map(key);
  const ops = diffSeq(a, b);
  if (!ops) return null;
  const removedByRef = new Map<number, number>();
  for (const o of ops) if (o.k === '-' && prev[o.a!].r) removedByRef.set(prev[o.a!].r!, o.a!);
  const changedRefs = new Set<number>();
  for (const o of ops) if (o.k === '+' && next[o.b!].r && removedByRef.has(next[o.b!].r!)) changedRefs.add(next[o.b!].r!);

  const out: string[] = [];
  let added = 0, removed = 0, changed = 0;
  let lastCtx = -1;
  const ctxOf = (bi: number): number => {
    const d = next[bi].d;
    for (let i = bi - 1; i >= 0; i--) if (next[i].d < d && next[i].ctx) return i;
    return -1;
  };
  const addedB = new Set<number>();
  for (const o of ops) if (o.k === '+') addedB.add(o.b!);
  const removedLines: string[] = [];
  let removedInteractive = 0;
  for (const o of ops) {
    if (o.k === '+') {
      const l = next[o.b!];
      const c = ctxOf(o.b!);
      if (c >= 0 && c !== lastCtx && !addedB.has(c)) {
        out.push('@ ' + next[c].t);
        lastCtx = c;
      }
      if (l.r && changedRefs.has(l.r)) { out.push('~ ' + l.t); changed++; }
      else { out.push('+ ' + ' '.repeat(l.d) + l.t); added++; }
    } else if (o.k === '-') {
      const l = prev[o.a!];
      if (l.r && changedRefs.has(l.r)) continue;
      removed++;
      if (l.r) removedInteractive++;
      removedLines.push(l.t);
    }
  }
  if (removedLines.length) {
    if (removedLines.length <= 6) for (const t of removedLines) out.push('- ' + t);
    else out.push(`- ${removedLines.length} lines gone (${removedInteractive} controls), e.g. ${removedLines.slice(0, 3).map((t) => t.slice(0, 40)).join(' | ')}`);
  }
  let text = out.join('\n');
  let tokens = estimateTokens(text);
  if (tokens > fullTokens * 0.75) return null;
  if (tokens > maxTokens) {
    // Keep the head of the diff; the model can observe for the rest.
    const keep: string[] = [];
    let used = 0;
    for (const l of out) {
      const c = estimateTokens(l) + 1;
      if (used + c > maxTokens) break;
      keep.push(l);
      used += c;
    }
    text = keep.join('\n') + `\n… diff truncated (${out.length - keep.length} more lines): observe for full view`;
    tokens = estimateTokens(text);
  }
  return { text, added, removed, changed, tokens };
}
