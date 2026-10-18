/**
 * Small commands that run instead of the server, for people who installed the npm package:
 *
 *   whittlebrowser install-skill [--dir SKILLS_DIR]   copy the bundled skill to ~/.claude/skills/whittlebrowser
 *   whittlebrowser print-config [server flags]        print the MCP config JSON for apps that need full paths (Claude Desktop)
 */
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package root is two folders above this file in both the built (dist/mcp) and source (src/mcp) layouts. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Copies the bundled skill into a skills folder and returns the folder it created. */
export function installSkill(skillsDir: string): string {
  const from = join(packageRoot, 'skills', 'whittlebrowser');
  if (!existsSync(join(from, 'SKILL.md'))) throw new Error(`the skill is missing from this install (${from})`);
  const to = join(skillsDir, 'whittlebrowser');
  mkdirSync(skillsDir, { recursive: true });
  cpSync(from, to, { recursive: true });
  return to;
}

/**
 * Config for clients that do not see the shell PATH (Claude Desktop with an nvm Node): the full path of node and of the
 * installed file, because `npx` and the `whittlebrowser` command both start with `#!/usr/bin/env node`.
 */
export function configFor(cliPath: string, serverArgs: string[]) {
  return { mcpServers: { whittlebrowser: { command: process.execPath, args: [cliPath, ...serverArgs] } } };
}

export async function runCommand(name: 'install-skill' | 'print-config', argv: string[]): Promise<number> {
  if (name === 'install-skill') {
    const i = argv.indexOf('--dir');
    const dir = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills');
    try {
      console.log(`Installed the whittlebrowser skill to ${installSkill(dir)}. Claude Code picks it up in new sessions.`);
      return 0;
    } catch (e) {
      console.error(`Could not install the skill: ${(e as Error).message}`);
      return 1;
    }
  }
  const cli = realpathSync(process.argv[1]);
  if (/[\\/]_npx[\\/]/.test(cli)) {
    console.error('Note: this path is in npx\'s temporary cache and will disappear. Run `npm i -g @whittlebrowser/engine`, then `whittlebrowser print-config`.');
  }
  console.log(JSON.stringify(configFor(cli, argv), null, 2));
  return 0;
}
