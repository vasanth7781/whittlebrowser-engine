/**
 * Agent benchmark: does a real model still finish the task, and what does it cost?
 * Claude Code (`claude -p`, your subscription) is the agent; each arm is an MCP server for one browser tool:
 *   whittle      this repo's MCP server
 *   playwright   @playwright/mcp (snapshot after every call)
 *   browser-use  `browser-use --mcp` (its direct-control tools; its LLM-backed tools are disabled)
 *   stagehand    bench/agent/stagehand-mcp.mjs (Stagehand's page.snapshot() tree behind a thin shim)
 * Claude Code's default system prompt is replaced by a short one and built-in tools are off, so the only
 * context is the task, that prompt, the arm's tool definitions and what the arm returns.
 *
 *   pnpm bench:agent --smoke                          one rep of one task per arm on haiku
 *   pnpm bench:agent --arms whittle,playwright --models haiku,sonnet --reps 3
 *   flags: --arms a,b  --models m,n  --tasks t1,t2  --reps N  --jobs N  --out DIR
 * Results append to bench/agent/results/runs.jsonl and finished (arm, model, task, rep) cells are skipped on rerun.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { TASKS, type Task } from './tasks.js';

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, '../..');
const compare = join(engine, 'bench/compare');
const arg = (k: string, d = '') => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const flag = (k: string) => process.argv.includes(`--${k}`);

const smoke = flag('smoke');
const arms = (arg('arms') || 'whittle,playwright,browser-use,stagehand').split(',');
const models = (arg('models') || 'haiku').split(',');
const taskIds = (arg('tasks') || (smoke ? 'table' : TASKS.map((t) => t.id).join(','))).split(',');
const reps = +(arg('reps') || (smoke ? 1 : 3));
const jobs = +(arg('jobs') || 2);
const outDir = resolve(arg('out') || join(here, 'results'));
const port = +(process.env.BENCH_PORT || 4399);
const maxTurns = +(arg('max-turns') || 40);
const timeoutMs = +(arg('timeout') || 8 * 60_000);
const exe = chromium.executablePath();
const base = `http://127.0.0.1:${port}`;

type Server = { command: string; args: string[]; env?: Record<string, string> };
const armServer = (arm: string, work: string): { server: Server; deny: string[] } => {
  switch (arm) {
    case 'whittle':
      return { server: { command: process.execPath, args: [join(engine, 'dist/mcp/cli.js'), '--headless', '--ephemeral', '--risk', 'auto', '--no-identify', '--robots', 'off'] }, deny: [] };
    case 'playwright':
      return { server: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--executable-path', exe, '--viewport-size', '1280x860'] }, deny: [] };
    case 'browser-use': {
      const cfg = join(work, 'bu');
      mkdirSync(cfg, { recursive: true });
      writeFileSync(join(cfg, 'config.json'), JSON.stringify({
        browser_profile: { p: { id: 'p', default: true, created_at: '', headless: true, user_data_dir: null, executable_path: exe, viewport: { width: 1280, height: 860 } } },
        llm: {}, agent: {},
      }));
      return {
        server: { command: join(compare, '.venv/bin/browser-use'), args: ['--mcp'], env: { BROWSER_USE_CONFIG_DIR: cfg, BROWSER_USE_HEADLESS: 'true', ANONYMIZED_TELEMETRY: 'false' } },
        // these two call a second LLM (needs an OpenAI key), which is outside a Claude-only run
        deny: ['mcp__arm__retry_with_browser_use_agent', 'mcp__arm__browser_extract_content'],
      };
    }
    case 'stagehand':
      return { server: { command: process.execPath, args: [join(here, 'stagehand-mcp.mjs'), '--exe', exe] }, deny: [] };
    default:
      throw new Error(`unknown arm ${arm}`);
  }
};

const SYSTEM = 'You are a browser agent. Use the browser tools to complete the task. Do not answer from memory. When done, reply with one line starting "ANSWER:" followed by the answer.';

interface Run {
  arm: string; model: string; task: string; rep: number;
  ok: boolean; answer: string; turns: number; toolCalls: number; toolResultChars: number;
  input: number; cacheWrite: number; cacheRead: number; output: number; costUsd: number; ms: number; error?: string;
}

function runOne(arm: string, model: string, task: Task, rep: number): Promise<Run> {
  const work = join(tmpdir(), `wb-agent-${process.pid}-${arm}-${task.id}-${rep}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(work, { recursive: true });
  const { server, deny } = armServer(arm, work);
  const cfg = join(work, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { arm: server } }));
  const args = [
    '-p', task.prompt(base), '--model', model, '--output-format', 'stream-json', '--verbose',
    '--mcp-config', cfg, '--strict-mcp-config', '--tools', '', '--allowedTools', 'mcp__arm',
    ...(deny.length ? ['--disallowedTools', deny.join(',')] : []),
    '--system-prompt', SYSTEM, '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
    '--max-turns', String(maxTurns),
  ];
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn('claude', args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', err = '';
    child.stdout.on('data', (d) => (buf += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-1500)));
    const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', () => {
      clearTimeout(kill);
      let toolCalls = 0, toolResultChars = 0;
      let result: any = null;
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        let m: any;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'assistant') for (const c of m.message?.content ?? []) if (c.type === 'tool_use') toolCalls++;
        if (m.type === 'user') for (const c of m.message?.content ?? []) if (c.type === 'tool_result') {
          toolResultChars += typeof c.content === 'string' ? c.content.length : JSON.stringify(c.content ?? '').length;
        }
        if (m.type === 'result') result = m;
      }
      const u = result ? Object.values<any>(result.modelUsage ?? {}) : [];
      const sum = (k: string) => u.reduce((a, x) => a + (x[k] ?? 0), 0);
      const answer = String(result?.result ?? '');
      done({
        arm, model, task: task.id, rep,
        ok: !!result && !result.is_error && task.check(answer),
        answer: answer.slice(0, 400), turns: result?.num_turns ?? 0, toolCalls, toolResultChars,
        input: sum('inputTokens'), cacheWrite: sum('cacheCreationInputTokens'), cacheRead: sum('cacheReadInputTokens'), output: sum('outputTokens'),
        costUsd: result?.total_cost_usd ?? 0, ms: Date.now() - t0,
        error: result ? (result.is_error ? String(result.subtype) : undefined) : `no result: ${err.slice(-300)}`,
      });
    });
  });
}

// ---------- schedule ----------
mkdirSync(outDir, { recursive: true });
const file = join(outDir, 'runs.jsonl');
const key = (r: { arm: string; model: string; task: string; rep: number }) => `${r.arm}|${r.model}|${r.task}|${r.rep}`;
const done = new Set<string>(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => key(JSON.parse(l))) : []);
const queue: { arm: string; model: string; task: Task; rep: number }[] = [];
for (let rep = 1; rep <= reps; rep++) for (const model of models) for (const t of taskIds) for (const arm of arms) {
  const task = TASKS.find((x) => x.id === t);
  if (!task) throw new Error(`unknown task ${t}`);
  if (!done.has(key({ arm, model, task: t, rep }))) queue.push({ arm, model, task, rep });
}
console.error(`${queue.length} runs (${arms.join(',')} × ${models.join(',')} × ${taskIds.join(',')} × ${reps} reps), ${jobs} at a time`);

// bring up the fixtures server unless one is already listening
const probe = await fetch(`${base}/table.html`).then((r) => r.ok).catch(() => false);
const fx = probe ? null : spawn(process.execPath, [join(here, 'fixtures-server.mjs'), String(port)], { stdio: 'inherit' });
if (fx) await new Promise((r) => setTimeout(r, 600));

let n = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  for (let j = queue.shift(); j; j = queue.shift()) {
    const r = await runOne(j.arm, j.model, j.task, j.rep);
    appendFileSync(file, JSON.stringify(r) + '\n');
    console.error(`[${++n}] ${r.ok ? 'PASS' : 'FAIL'} ${r.arm}/${r.model}/${r.task}#${r.rep}  turns ${r.turns}  tools ${r.toolCalls}  in ${r.input + r.cacheWrite + r.cacheRead}  out ${r.output}  $${r.costUsd.toFixed(3)}  ${(r.ms / 1000).toFixed(0)}s${r.ok ? '' : `  ← ${r.error ?? r.answer.slice(0, 80)}`}`);
  }
}));
fx?.kill();
process.exit(0);
