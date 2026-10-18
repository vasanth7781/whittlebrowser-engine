#!/usr/bin/env node
// Connects an MCP client to this checkout.
//   pnpm connect                 add the server to Claude Code, and print the JSON for other clients
//   pnpm connect codex           add it to Codex instead
//   pnpm connect desktop         add it to Claude Desktop (edits its config file, keeps a backup; restart the app after)
//   pnpm connect all             all three
//   pnpm connect --print         only print, change nothing
//   pnpm connect --headless      any other arguments go to the server (--headless, --ephemeral, --budget 4000 ...)
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '../packages/engine/dist/mcp/cli.js');
if (!existsSync(cli)) {
  console.error('The engine is not built yet. Run:  pnpm --filter @whittlebrowser/engine build');
  process.exit(1);
}
const TARGETS = ['claude', 'codex', 'desktop', 'all'];
const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const target = args.find((a) => TARGETS.includes(a)) ?? 'claude';
const extra = args.filter((a) => a !== '--print' && !TARGETS.includes(a));

// Apps started from the Dock or Finder do not see a Node installed through nvm, so config files get the full path.
const entry = { command: process.execPath, args: [cli, ...extra] };

function desktopConfigPath() {
  if (process.env.CLAUDE_DESKTOP_CONFIG) return process.env.CLAUDE_DESKTOP_CONFIG;
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'Claude/claude_desktop_config.json');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude/claude_desktop_config.json');
}

function addToDesktop() {
  const file = desktopConfigPath();
  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(`Could not read ${file} as JSON, so it was left alone. Fix or remove it and run this again.`);
      return false;
    }
    copyFileSync(file, `${file}.bak`);
  } else mkdirSync(dirname(file), { recursive: true });
  config.mcpServers = { ...(config.mcpServers ?? {}), whittlebrowser: entry };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(`Added whittlebrowser to ${file}${existsSync(`${file}.bak`) ? ` (previous version saved as ${file}.bak)` : ''}.\nQuit Claude Desktop completely (⌘Q) and open it again, then ask it to open a web page with whittlebrowser.`);
  return true;
}

const clients = target === 'all' ? ['claude', 'codex', 'desktop'] : [target];
let failed = false;
if (!printOnly) {
  for (const c of clients) {
    if (c === 'desktop') {
      if (!addToDesktop()) failed = true;
      continue;
    }
    const r = spawnSync(c, ['mcp', 'add', 'whittlebrowser', '--', 'node', cli, ...extra], { stdio: 'inherit' });
    if (r.error) console.error(`The \`${c}\` CLI was not found, so nothing was added to it. Use the JSON below for other clients.\n`);
    else if (r.status !== 0) failed = true;
  }
}
console.log('\nFor Cursor, VS Code, Gemini CLI and other clients, put this in their MCP config:\n');
console.log(JSON.stringify({ mcpServers: { whittlebrowser: entry } }, null, 2));
process.exit(failed ? 1 : 0);
