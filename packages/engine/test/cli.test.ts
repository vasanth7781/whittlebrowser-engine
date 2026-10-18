import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args: string[]) => execFileSync(join(root, 'node_modules/.bin/tsx'), [join(root, 'src/mcp/cli.ts'), ...args], { encoding: 'utf8', cwd: root, timeout: 20_000 });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('whittlebrowser install-skill', () => {
  it('copies the bundled skill into a skills folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-skills-'));
    expect(run('install-skill', '--dir', dir)).toContain('Installed the whittlebrowser skill');
    expect(readFileSync(join(dir, 'whittlebrowser/SKILL.md'), 'utf8')).toBe(readFileSync(join(root, 'skills/whittlebrowser/SKILL.md'), 'utf8'));
  });
});

describe('whittlebrowser print-config', () => {
  it('prints the config with full paths, passes server flags through, and does not start a browser', () => {
    const t0 = Date.now();
    const cfg = JSON.parse(run('print-config', '--headless', '--ephemeral')).mcpServers.whittlebrowser;
    expect(existsSync(cfg.command)).toBe(true);        // an absolute node, not a bare "node"
    expect(existsSync(cfg.args[0])).toBe(true);        // the installed cli file
    expect(cfg.args.slice(1)).toEqual(['--headless', '--ephemeral']);
    expect(Date.now() - t0).toBeLessThan(15_000);      // it returned instead of waiting on a browser
  });
});

describe('MCP Registry metadata (server.json)', () => {
  const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));
  it('matches package.json, which the registry checks against the published package', () => {
    expect(pkg.mcpName).toMatch(/^io\.github\.[a-z0-9-]+\//); // GitHub sign-in requires this prefix
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]).toMatchObject({ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } });
    expect(server.repository.url).toBe(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
  });
});
