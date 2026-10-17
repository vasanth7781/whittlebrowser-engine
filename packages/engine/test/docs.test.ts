import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

  it('use the current command and protocol names', () => {
    const repo = join(docs, '..');
    const pkg = JSON.parse(readFileSync(join(repo, 'packages/engine/package.json'), 'utf8'));
    expect(Object.keys(pkg.bin)).toEqual(['whittlebrowser']);
    const stale = /whittlebrowser-mcp|--shell\b|ShellPolicy|shell\.json/;
    const scan = [...files.map((f) => join(docs, f)), join(repo, 'README.md'), join(repo, 'SECURITY.md'), join(repo, 'packages/engine/README.md'), join(repo, '.mcp.json.example')];
    for (const f of scan) expect(readFileSync(f, 'utf8'), f).not.toMatch(stale);
  });

  it('pnpm connect --print gives a config that points at the built server', () => {
    const repo = join(docs, '..');
    const out = execFileSync('node', [join(repo, 'scripts/connect.mjs'), '--print', '--headless'], { encoding: 'utf8' });
    const json = JSON.parse(out.slice(out.indexOf('{')));
    const [cli, flag] = json.mcpServers.whittlebrowser.args;
    expect(existsSync(cli)).toBe(true);
    expect(flag).toBe('--headless');
  });

  it('pnpm connect takes a client name without passing it to the server', () => {
    const repo = join(docs, '..');
    const out = execFileSync('node', [join(repo, 'scripts/connect.mjs'), 'codex', '--print', '--headless'], { encoding: 'utf8' });
    const args = JSON.parse(out.slice(out.indexOf('{'))).mcpServers.whittlebrowser.args;
    expect(args.slice(1)).toEqual(['--headless']);
  });
});
