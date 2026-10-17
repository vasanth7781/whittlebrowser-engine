#!/usr/bin/env node
// Connects an MCP client to this checkout.
//   pnpm connect                 add the server to Claude Code, and print the JSON for other clients
//   pnpm connect codex           add it to Codex instead
//   pnpm connect all             add it to both
//   pnpm connect --print         only print, change nothing
//   pnpm connect --headless      any other arguments go to the server (--headless, --ephemeral, --budget 4000 ...)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '../packages/engine/dist/mcp/cli.js');
if (!existsSync(cli)) {
  console.error('The engine is not built yet. Run:  pnpm --filter @whittlebrowser/engine build');
  process.exit(1);
}
const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const target = args.find((a) => ['claude', 'codex', 'all'].includes(a)) ?? 'claude';
const extra = args.filter((a) => a !== '--print' && !['claude', 'codex', 'all'].includes(a));

const clients = target === 'all' ? ['claude', 'codex'] : [target];
let failed = false;
if (!printOnly) {
  for (const c of clients) {
    const r = spawnSync(c, ['mcp', 'add', 'whittlebrowser', '--', 'node', cli, ...extra], { stdio: 'inherit' });
    if (r.error) console.error(`The \`${c}\` CLI was not found, so nothing was added to it. Use the JSON below for other clients.\n`);
    else if (r.status !== 0) failed = true;
  }
}
console.log('\nFor Cursor, VS Code, Claude Desktop, Gemini CLI and other clients, put this in their MCP config:\n');
console.log(JSON.stringify({ mcpServers: { whittlebrowser: { command: 'node', args: [cli, ...extra] } } }, null, 2));
process.exit(failed ? 1 : 0);
