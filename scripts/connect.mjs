#!/usr/bin/env node
// Connects an MCP client to this checkout.
//   pnpm connect               add the server to Claude Code (if the `claude` CLI is installed) and print the JSON for other clients
//   pnpm connect --print       only print
//   pnpm connect --headless    any extra arguments are passed to the server (--headless, --ephemeral, --budget 4000 ...)
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
const extra = args.filter((a) => a !== '--print');

const json = { mcpServers: { whittlebrowser: { command: 'node', args: [cli, ...extra] } } };
if (!printOnly) {
  const r = spawnSync('claude', ['mcp', 'add', 'whittlebrowser', '--', 'node', cli, ...extra], { stdio: 'inherit' });
  if (r.error) console.error('The `claude` CLI was not found, so nothing was added to Claude Code. Use the JSON below instead.\n');
  else if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('\nFor Cursor, VS Code, Claude Desktop and other clients, put this in their MCP config:\n');
console.log(JSON.stringify(json, null, 2));
