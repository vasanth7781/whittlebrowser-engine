import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'skills/whittlebrowser/SKILL.md');

/** Frontmatter exactly as Claude and GitHub read it: a YAML block between the first two --- lines. */
export function frontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('SKILL.md must start with a --- frontmatter block');
  return parse(m[1]);
}

describe('SKILL.md', () => {
  const text = readFileSync(file, 'utf8');

  it('has valid YAML frontmatter with the fields Claude requires', () => {
    const fm = frontmatter(text);
    expect(fm.name).toBe('whittlebrowser'); // must match the folder name
    expect(typeof fm.description).toBe('string');
    expect((fm.description as string).length).toBeGreaterThan(40);
    expect((fm.description as string).length).toBeLessThanOrEqual(1024);
    expect(fm.name as string).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(fm.name as string).not.toMatch(/anthropic|claude/);
    expect(fm.description as string).not.toMatch(/<[a-z/]+>/i);
  });

  it('catches the mistake that broke it on GitHub (an unquoted colon in the description)', () => {
    const broken = '---\nname: whittlebrowser\ndescription: Use it when a task needs reading or operating real web pages: looking something up.\n---\n';
    expect(() => frontmatter(broken)).toThrow();
  });

  it('stays short enough to load cheaply', () => {
    expect(text.split('\n').length).toBeLessThan(500);
  });
});

describe('SKILL.md matches the server', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ name: 'skill-test', version: '0' });
    await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', join(root, 'src/mcp/cli.ts'), '--headless', '--ephemeral'], cwd: root, stderr: 'ignore' }));
  });
  afterAll(async () => { await client?.close(); });

  it('mentions every tool, and no tool that does not exist', async () => {
    const text = readFileSync(file, 'utf8');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of names) expect(text, `the skill never mentions ${n}`).toContain(`\`${n}\``);
    const table = [...text.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
    expect(table.sort()).toEqual([...names].sort());
  });

  it('uses argument names the tools really have', async () => {
    const { tools } = await client.listTools();
    const props = (n: string) => Object.keys((tools.find((t) => t.name === n)!.inputSchema as { properties: object }).properties);
    expect(props('act')).toEqual(expect.arrayContaining(['steps', 'confirm']));
    expect(props('wait')).toEqual(expect.arrayContaining(['text', 'gone', 'ms', 'user']));
    expect(props('extract')).toEqual(expect.arrayContaining(['kind', 'offset']));
    expect(props('observe')).toEqual(expect.arrayContaining(['mode', 'ref']));
    expect(props('research')).toEqual(expect.arrayContaining(['urls']));
  });
});
