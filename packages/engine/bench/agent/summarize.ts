/**
 * Turns bench/agent/results/runs.jsonl into tables (markdown on stdout, JSON in results/summary.json).
 *   pnpm tsx bench/agent/summarize.ts [runs.jsonl]
 * The OpenAI columns re-price the same measured tokens at OpenAI list prices, as an estimate of what the
 * same battery would cost there. Real counts differ a little (other tokenizer, other turn counts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TASKS } from './tasks.js';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(here, 'results/runs.jsonl');
interface Run { arm: string; model: string; task: string; rep: number; ok: boolean; answer: string; error?: string; turns: number; toolCalls: number; toolResultChars: number; input: number; cacheWrite: number; cacheRead: number; output: number; costUsd: number; ms: number; }
const runs: Run[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Score again with the current checkers, so a checker fix never needs a rerun.
for (const r of runs) { const t = TASKS.find((x) => x.id === r.task); if (t) r.ok = !r.error && t.check(r.answer); }

// USD per 1M tokens: [input, cached input, output]. Source: developers.openai.com/api/docs/pricing, standard tier.
const OPENAI: Record<string, { name: string; p: [number, number, number] }> = {
  haiku: { name: 'gpt-6-luna', p: [0.1, 0.01, 0.5] },
  sonnet: { name: 'gpt-6.1-sol', p: [2, 0.1, 10] },
};
const openaiCost = (r: Run, model: string) => { const [i, c, o] = OPENAI[model].p; return ((r.input + r.cacheWrite) * i + r.cacheRead * c + r.output * o) / 1e6; };

const ARMS = ['whittle', 'whittle-before', 'playwright', 'browser-use', 'stagehand'];
const NAMES: Record<string, string> = { whittle: 'WhittleBrowser', 'whittle-before': 'WhittleBrowser (before fix)', playwright: 'Playwright MCP', 'browser-use': 'browser-use', stagehand: 'Stagehand' };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f0 = (n: number) => Math.round(n).toLocaleString('en-US');
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;
const tokens = (r: Run) => r.input + r.cacheWrite + r.cacheRead + r.output;

const out: string[] = [];
const log = (s = '') => out.push(s);
const summary: any = { models: {}, tasks: {} };
const models = [...new Set(runs.map((r) => r.model))];
const tasks = [...new Set(runs.map((r) => r.task))];

for (const model of models) {
  const mr = runs.filter((r) => r.model === model);
  log(`## ${model}${OPENAI[model] ? ` (OpenAI estimate priced as ${OPENAI[model].name})` : ''}\n`);
  log('| arm | passed | mean tokens / run | vs Playwright MCP | mean tool calls | mean turns | mean cost (Claude list) | mean cost (OpenAI est.) | mean time |');
  log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const pw = mean(mr.filter((r) => r.arm === 'playwright').map(tokens));
  summary.models[model] = {};
  for (const arm of ARMS) {
    const rs = mr.filter((r) => r.arm === arm);
    if (!rs.length) continue;
    const t = mean(rs.map(tokens));
    const row = { runs: rs.length, passed: rs.filter((r) => r.ok).length, tokens: t, toolCalls: mean(rs.map((r) => r.toolCalls)), turns: mean(rs.map((r) => r.turns)), costUsd: mean(rs.map((r) => r.costUsd)), openaiUsd: OPENAI[model] ? mean(rs.map((r) => openaiCost(r, model))) : null, seconds: mean(rs.map((r) => r.ms)) / 1000 };
    summary.models[model][arm] = row;
    log(`| ${NAMES[arm]} | ${row.passed}/${row.runs} | ${f0(t)} | ${pw && arm !== 'playwright' ? `${t < pw ? '−' : '+'}${Math.abs(Math.round((1 - t / pw) * 100))}%` : '–'} | ${row.toolCalls.toFixed(1)} | ${row.turns.toFixed(1)} | ${usd(row.costUsd)} | ${row.openaiUsd === null ? 'n/a' : usd(row.openaiUsd)} | ${row.seconds.toFixed(0)}s |`);
  }
  log();
}

log('## Pass rate and mean tokens per task (all models)\n');
log(`| task | ${ARMS.map((a) => NAMES[a]).join(' | ')} |`);
log(`|---|${ARMS.map(() => '---:').join('|')}|`);
for (const task of tasks) {
  const cells = ARMS.map((arm) => {
    const rs = runs.filter((r) => r.task === task && r.arm === arm);
    return rs.length ? `${rs.filter((r) => r.ok).length}/${rs.length} · ${f0(mean(rs.map(tokens)))}` : '–';
  });
  summary.tasks[task] = Object.fromEntries(ARMS.map((a, i) => [a, cells[i]]));
  log(`| ${task} | ${cells.join(' | ')} |`);
}
log();

// What running the whole battery once would cost, per arm and model.
log('## Cost of one pass over the battery (7 tasks)\n');
log(`| arm | ${models.map((m) => `${m} (Claude list)`).join(' | ')} | ${models.filter((m) => OPENAI[m]).map((m) => `${m} → ${OPENAI[m].name} (est.)`).join(' | ')} |`);
log(`|---|${[...models, ...models.filter((m) => OPENAI[m])].map(() => '---:').join('|')}|`);
for (const arm of ARMS) {
  const per = (m: string, f: (r: Run) => number) => { const rs = runs.filter((r) => r.arm === arm && r.model === m); return rs.length ? usd(mean(rs.map(f)) * tasks.length) : '–'; };
  log(`| ${NAMES[arm]} | ${models.map((m) => per(m, (r) => r.costUsd)).join(' | ')} | ${models.filter((m) => OPENAI[m]).map((m) => per(m, (r) => openaiCost(r, m))).join(' | ')} |`);
}

writeFileSync(join(dirname(file), 'summary.json'), JSON.stringify(summary, null, 2));
console.log(out.join('\n'));
