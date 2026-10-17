import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '../../../docs');
const files = readdirSync(docs).filter((f) => f.endsWith('.md'));

describe('docs', () => {
  it('only link to docs that exist', () => {
    const broken: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(docs, f), 'utf8');
      for (const m of text.matchAll(/\]\(([A-Za-z0-9._-]+\.(md|html))(#[^)]*)?\)/g)) {
        const target = m[2] === 'html' ? m[1].replace(/\.html$/, '') : m[1].replace(/\.md$/, '');
        const ok = files.some((x) => x.replace(/\.md$/, '').toLowerCase() === target.toLowerCase()) || existsSync(join(docs, m[1])) || ['index', 'getting-started'].includes(target);
        if (!ok) broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('keep benchmark numbers in sync with benchmark.json', () => {
    const j = JSON.parse(readFileSync(join(docs, 'benchmark.json'), 'utf8'));
    const f = (n: number) => n.toLocaleString('en-US');
    const text = readFileSync(join(docs, 'BENCHMARK.md'), 'utf8');
    const total = (k: 'pw' | 'bu' | 'sh' | 'ours') => j.pages.reduce((a: number, p: Record<string, number | null>) => a + (p[k] ?? 0), 0);
    for (const k of ['pw', 'bu', 'sh', 'ours'] as const) expect(text, `page total for ${k}`).toContain(f(total(k)));
    expect(text).toContain(f(j.fixed.ours));
  });
});
