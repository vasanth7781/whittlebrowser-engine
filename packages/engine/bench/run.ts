/**
 * Benchmark: WhittleBrowser vs Playwright MCP, browser-use and Stagehand. Each tool is measured with its
 * own code on the same Chromium and pages, without calling an LLM:
 *   Playwright MCP  page.ariaSnapshot({ mode: 'ai' }), the text it returns after every tool call
 *   browser-use     BrowserSession state -> AgentMessagePrompt.get_user_message (bench/compare/bu_measure.py)
 *   Stagehand       page.snapshot() hybrid tree used by act/observe/extract (bench/compare/stagehand/sh_measure.mjs)
 *
 *   pnpm bench            fixtures only (deterministic)
 *   pnpm bench --live     also real sites (needs network)
 *   pnpm bench --pw-mcp   also count @playwright/mcp tool-definition tokens (downloads it via npx)
 *   bench/compare/setup.sh once, to install browser-use and Stagehand for the comparison columns
 *
 * Tokens are counted with o200k_base as a model-neutral proxy.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEncoding } from 'js-tiktoken';
import type { Page } from 'playwright-core';
import { serve, start } from '../test/helpers.js';
import type { Session } from '../src/driver/session.js';

const enc = getEncoding('o200k_base');
const tok = (s: string) => enc.encode(s).length;
const here = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');
const pwMcp = process.argv.includes('--pw-mcp');

const pwSnap = (p: Page) => p.ariaSnapshot({ mode: 'ai' } as never);
const refOf = (text: string, needle: string) => {
  const m = text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*?${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (!m) throw new Error(`ref for ${needle} not found`);
  return +m[1];
};

interface Row { name: string; url: string; pw: number; ours: number; bu?: number; buImg?: number; sh?: number; }
const out: string[] = [];
/** Machine-readable results for the website/docs charts (bench/results/latest.json). */
const R: Record<string, any> = { date: new Date().toISOString().slice(0, 10), tokenizer: 'o200k_base', versions: { browserUse: '0.13.11', stagehand: '4.2.1', playwrightMcp: 'latest' }, pages: [], tasks: [], safety: {}, fixed: {}, allin: {} };
const log = (s = '') => { console.log(s); out.push(s); };
const pct = (a: number, b: number) => `${Math.round((1 - b / a) * 100)}%`;

const srv = await serve();
const { s, b } = await start({ allowSensitive: [] }, { robots: 'off' });
const page = async () => (s as unknown as { page(): Promise<Page> }).page();

const pages = ['shipping.html', 'spa.html', 'table.html', 'article.html', 'injection.html'].map((f) => ({ name: f, url: srv.url(f) }));
if (live) {
  pages.push(
    { name: 'wikipedia: Pancake', url: 'https://en.wikipedia.org/wiki/Pancake' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/' },
    { name: 'GitHub repo', url: 'https://github.com/microsoft/playwright' },
    { name: 'MDN <input>', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input' },
    { name: 'BBC News', url: 'https://www.bbc.com/news' },
    { name: 'Python docs', url: 'https://docs.python.org/3/library/asyncio.html' },
  );
}
// ---------- competitors: run their own serializers on the same pages ----------
const cmpDir = join(here, 'compare');
const extra = ['review.html', 'divsoup.html', 'canary.html'].map((f) => srv.url(f));
const allUrls = [...pages.map((p) => p.url), ...extra];
interface BU { system: number; schema: number; pages: { url: string; state?: number; image?: number; text?: string; error?: string }[] }
interface SH { fixed: number; pages: { url: string; tree?: number; text?: string; error?: string }[] }
// Async on purpose: the fixture server lives in this process and must keep answering while they run.
const runJson = <T>(cmd: string, args: string[], cwd: string): Promise<T | null> => new Promise((resolve) => {
  if (!existsSync(cmd) && !cmd.endsWith('node')) return resolve(null);
  const child = spawn(cmd, args, { cwd });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  const kill = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
  child.on('close', () => {
    clearTimeout(kill);
    const line = stdout.split('\n').reverse().find((l) => l.startsWith('{'));
    if (!line) { console.error(`${cmd} failed:`, stderr.slice(-400)); return resolve(null); }
    resolve(JSON.parse(line) as T);
  });
});
const skipCompare = process.argv.includes('--no-compare');
console.error('measuring browser-use and Stagehand…');
const [bu, sh] = skipCompare ? [null, null] : await Promise.all([
  runJson<BU>(join(cmpDir, '.venv/bin/python'), ['bu_measure.py', chromium.executablePath(), ...allUrls], cmpDir),
  existsSync(join(cmpDir, 'stagehand/node_modules')) ? runJson<SH>(process.execPath, ['sh_measure.mjs', chromium.executablePath(), ...allUrls], join(cmpDir, 'stagehand')) : Promise.resolve(null),
]);
console.error(`browser-use: ${bu ? bu.pages.length + ' pages' : 'skipped'} · Stagehand: ${sh ? sh.pages.length + ' pages' : 'skipped'}`);
const buOf = (url: string) => bu?.pages.find((p) => p.url === url);
const shOf = (url: string) => sh?.pages.find((p) => p.url === url);

// ---------- 1. single observation size ----------
log('## 1. One observation (tokens, o200k)\n');
log('What each tool puts in front of the model for one look at the page. browser-use also attaches a screenshot by default (≈1,468 image tokens at 1280×860, shown separately).\n');
log('| page | Playwright MCP | browser-use | Stagehand | WhittleBrowser | vs. smallest other |');
log('|---|---:|---:|---:|---:|---:|');
const rows: Row[] = [];
const fmt = (n?: number) => (n === undefined ? 'n/a' : n.toLocaleString('en-US'));
for (const pg of pages) {
  try {
    const ours = await s.navigate(pg.url);
    const p = await page();
    const pw = await pwSnap(p);
    const b1 = buOf(pg.url), s1 = shOf(pg.url);
    const r: Row = { name: pg.name, url: pg.url, pw: tok(pw), ours: tok(ours), bu: b1?.state, buImg: b1?.image, sh: s1?.tree };
    rows.push(r);
    R.pages.push({ name: r.name, pw: r.pw, bu: r.bu ?? null, buImg: r.buImg ?? null, sh: r.sh ?? null, ours: r.ours });
    const best = Math.min(...[r.pw, r.bu, r.sh].filter((x): x is number => typeof x === 'number'));
    log(`| ${r.name} | ${fmt(r.pw)} | ${fmt(r.bu)}${r.buImg ? ' (+img)' : ''} | ${fmt(r.sh)} | **${fmt(r.ours)}** | ${pct(best, r.ours)} |`);
  } catch (e) {
    log(`| ${pg.name} | error | ${(e as Error).message.slice(0, 50)} | | | |`);
  }
}
const sum = (k: 'pw' | 'ours' | 'bu' | 'sh') => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const complete = (k: 'bu' | 'sh') => rows.every((r) => r[k] !== undefined);
log(`| **total** | **${fmt(sum('pw'))}** | **${complete('bu') ? fmt(sum('bu')) : 'partial'}** | **${complete('sh') ? fmt(sum('sh')) : 'partial'}** | **${fmt(sum('ours'))}** | |`);
for (const [k, name] of [['pw', 'Playwright MCP'], ['bu', 'browser-use'], ['sh', 'Stagehand']] as const) {
  if (k === 'pw' || complete(k)) log(`\nWhittleBrowser vs ${name}: **${pct(sum(k), sum('ours'))} fewer tokens** per page view (${fmt(sum(k))} → ${fmt(sum('ours'))}).`);
}

// ---------- 2. multi-step tasks: Playwright MCP returns a full snapshot after every action ----------
log('\n## 2. Multi-step tasks (tokens returned to the model across the whole task)\n');
log('Playwright MCP and WhittleBrowser are measured by running the task. browser-use and Stagehand are modeled from their measured per-page sizes and their calling pattern: browser-use sends the full page state on every agent step (up to 5 actions per step, but a step ends when the page changes); Stagehand sends the page tree on every `act`/`extract` call.\n');
log('| task | steps | Playwright MCP | browser-use (modeled) | Stagehand (modeled) | WhittleBrowser | vs. smallest other |');
log('|---|---:|---:|---:|---:|---:|---:|');

/** Which page states each competitor sends, in order, for the same task. */
interface Model { bu: string[]; sh: string[] }
interface Task { name: string; url: string; model: Model; run(s: Session, p: Page): Promise<{ ours: number; pw: number; steps: number }>; }
const tasks: Task[] = [
  {
    name: 'fill shipping form + submit',
    url: 'shipping.html',
    // browser-use: state → 5 fills in one step → state → click → review state. Stagehand: one act per action.
    model: { bu: ['shipping.html', 'shipping.html', 'review.html'], sh: Array(6).fill('shipping.html') },
    async run(s, p) {
      const o = await s.navigate(srv.url('shipping.html'));
      let ours = tok(o);
      ours += tok(await s.act([
        { do: 'type', ref: refOf(o, '"Email"'), text: 'jane@example.com' },
        { do: 'type', ref: refOf(o, '"Full name"'), text: 'Jane Doe' },
        { do: 'select', ref: refOf(o, '"Country"'), values: ['Canada'] },
        { do: 'check', ref: refOf(o, '"This is a gift"') },
        { do: 'click', ref: refOf(o, '"Express"') },
      ]));
      ours += tok(await s.act([{ do: 'click', ref: refOf(o, '"Continue to review"') }]));
      // Playwright MCP: navigate + 6 actions, each returns a fresh snapshot.
      await p.goto(srv.url('shipping.html'));
      let pw = tok(await pwSnap(p));
      await p.getByRole('textbox', { name: 'Email' }).fill('jane@example.com'); pw += tok(await pwSnap(p));
      await p.getByRole('textbox', { name: 'Full name' }).fill('Jane Doe'); pw += tok(await pwSnap(p));
      await p.getByRole('combobox', { name: 'Country' }).selectOption('Canada'); pw += tok(await pwSnap(p));
      await p.getByText('This is a gift').click(); pw += tok(await pwSnap(p));
      await p.getByRole('radio', { name: 'Express' }).check(); pw += tok(await pwSnap(p));
      await p.getByRole('button', { name: 'Continue to review' }).click(); await p.waitForLoadState(); pw += tok(await pwSnap(p));
      return { ours, pw, steps: 7 };
    },
  },
  {
    name: 'todo: tick 3 items, load more',
    url: 'spa.html',
    // Each tick re-renders the list, which ends a browser-use step.
    model: { bu: Array(5).fill('spa.html'), sh: Array(4).fill('spa.html') },
    async run(s, p) {
      const o = await s.navigate(srv.url('spa.html'));
      let ours = tok(o);
      for (const n of [1, 2, 3]) ours += tok(await s.act([{ do: 'check', ref: refOf(o, `"Task number ${n}"`) }]));
      ours += tok(await s.act([{ do: 'click', ref: refOf(o, '"Load more"') }]));
      await p.goto(srv.url('spa.html'));
      let pw = tok(await pwSnap(p));
      for (const n of [1, 2, 3]) { await p.getByRole('checkbox', { name: `Task number ${n}`, exact: true }).check(); pw += tok(await pwSnap(p)); }
      await p.getByRole('button', { name: 'Load more' }).click(); await p.waitForTimeout(300); pw += tok(await pwSnap(p));
      return { ours, pw, steps: 5 };
    },
  },
  {
    name: 'catalog: find Widget 27, add to cart',
    url: 'table.html',
    model: { bu: ['table.html', 'table.html'], sh: ['table.html'] },
    async run(s, p) {
      let ours = tok(await s.navigate(srv.url('table.html')));
      const f = await s.find('Widget 27');
      ours += tok(f);
      ours += tok(await s.extract({ kind: 'list', offset: 26, budget: 120 }));
      ours += tok(await s.act([{ do: 'click', ref: refOf(f, '"Widget 27"') }]));
      await p.goto(srv.url('table.html'));
      let pw = tok(await pwSnap(p));
      await p.getByRole('link', { name: 'Widget 27' }).click(); await p.waitForLoadState(); pw += tok(await pwSnap(p));
      return { ours, pw, steps: 3 };
    },
  },
  {
    name: 'read article (first 2 sections)',
    url: 'article.html',
    model: { bu: ['article.html'], sh: ['article.html'] },
    async run(s, p) {
      await s.navigate(srv.url('article.html'));
      const ours = tok(await s.extract({ kind: 'text', budget: 4000 }));
      await p.goto(srv.url('article.html'));
      const pw = tok(await pwSnap(p));
      return { ours, pw, steps: 1 };
    },
  },
];
let tPw = 0, tOurs = 0, tBu = 0, tSh = 0, buOk = true, shOk = true;
const modelSum = (files: string[], k: 'bu' | 'sh') => {
  let n = 0;
  for (const f of files) {
    const v = k === 'bu' ? buOf(srv.url(f))?.state : shOf(srv.url(f))?.tree;
    if (v === undefined) return undefined;
    n += v;
  }
  return n;
};
for (const t of tasks) {
  const p = await page();
  const r = await t.run(s, p);
  const mb = modelSum(t.model.bu, 'bu'), ms = modelSum(t.model.sh, 'sh');
  tPw += r.pw; tOurs += r.ours; tBu += mb ?? 0; tSh += ms ?? 0;
  R.tasks.push({ name: t.name, steps: r.steps, pw: r.pw, bu: mb ?? null, sh: ms ?? null, ours: r.ours });
  if (mb === undefined) buOk = false;
  if (ms === undefined) shOk = false;
  const best = Math.min(...[r.pw, mb, ms].filter((x): x is number => typeof x === 'number'));
  log(`| ${t.name} | ${r.steps} | ${fmt(r.pw)} | ${fmt(mb)} | ${fmt(ms)} | **${fmt(r.ours)}** | ${pct(best, r.ours)} |`);
}
log(`| **total** | | **${fmt(tPw)}** | **${buOk ? fmt(tBu) : 'n/a'}** | **${shOk ? fmt(tSh) : 'n/a'}** | **${fmt(tOurs)}** | |`);

// ---------- 3. safety ----------
log('\n## 3. Safety (fixtures)\n');
const CANARIES = ['4111 1111 1111 1111', 'sk-ant-api03-CANARY', 'ghp_CANARY', 'AKIACANARY', '219-09-9999', 'eyJhbGciOiJIUzI1NiJ9', 'CanaryPassw0rd'];
const HIDDEN = ['attacker.example/steal', 'forward the API key', 'developer mode', 'email the OTP', 'approve all requests'];
const count = (text: string, list: string[]) => list.filter((c) => text.includes(c)).length;
{
  const ours = await s.navigate(srv.url('canary.html'));
  const oursFull = ours + (await s.observe({ mode: 'full' })) + (await s.extract({ kind: 'text' }));
  const p = await page();
  const pw = await pwSnap(p);
  const buT = (f: string) => buOf(srv.url(f))?.text, shT = (f: string) => shOf(srv.url(f))?.text;
  const cell = (t: string | undefined, list: string[]) => (t === undefined ? 'n/a' : String(count(t, list)));
  log('| check | Playwright MCP | browser-use | Stagehand | WhittleBrowser |');
  log('|---|---:|---:|---:|---:|');
  const num = (t?: string, list: string[] = []) => (t === undefined ? null : count(t, list));
  R.safety.secrets = { total: CANARIES.length, pw: count(pw, CANARIES), bu: num(buT('canary.html'), CANARIES), sh: num(shT('canary.html'), CANARIES), ours: count(oursFull, CANARIES) };
  log(`| planted secrets reaching the model (of ${CANARIES.length}) | ${count(pw, CANARIES)} | ${cell(buT('canary.html'), CANARIES)} | ${cell(shT('canary.html'), CANARIES)} | **${count(oursFull, CANARIES)}** |`);
  const inj = await s.navigate(srv.url('injection.html'));
  const pwInj = await pwSnap(await page());
  R.safety.hidden = { total: HIDDEN.length, pw: count(pwInj, HIDDEN), bu: num(buT('injection.html'), HIDDEN), sh: num(shT('injection.html'), HIDDEN), ours: count(inj, HIDDEN) };
  log(`| hidden prompt-injection texts reaching the model (of ${HIDDEN.length}) | ${count(pwInj, HIDDEN)} | ${cell(buT('injection.html'), HIDDEN)} | ${cell(shT('injection.html'), HIDDEN)} | **${count(inj, HIDDEN)}** |`);
  log(`| visible injection flagged ⚠ | no | no | no | **${inj.includes('⚠ IMPORTANT') ? 'yes' : 'no'}** |`);
  const card = await s.navigate(srv.url('card.html'));
  log(`| payment page auto-paused (nothing sent) | no | no | no | **${card.startsWith('⏸') ? 'yes' : 'no'}** |`);
}

// ---------- 4. tool definitions ----------
let defsOurs = 0, defsPw = 0;
log('\n## 4. Fixed overhead on every LLM call\n');
log('Text each tool adds to every request besides the page itself: tool definitions, system prompts and action schemas. (Agents that cache prompts pay less for repeats, but it still fills the context window.)\n');
{
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const defs = async (command: string, args: string[]) => {
    const c = new Client({ name: 'bench', version: '0' });
    await c.connect(new StdioClientTransport({ command, args, stderr: 'ignore', cwd: join(here, '..') }));
    const { tools } = await c.listTools();
    await c.close();
    return { n: tools.length, t: tok(JSON.stringify(tools.map((x) => ({ name: x.name, description: x.description, input_schema: x.inputSchema })))) };
  };
  const ours = await defs('npx', ['tsx', 'src/mcp/cli.ts', '--headless', '--ephemeral']);
  log('| tool | what is sent every call | tokens |');
  log('|---|---|---:|');
  if (pwMcp) {
    try {
      const pw = await defs('npx', ['-y', '@playwright/mcp@latest', '--headless']);
      defsPw = pw.t;
      log(`| Playwright MCP | ${pw.n} tool definitions | ${fmt(pw.t)} |`);
    } catch (e) {
      log(`| Playwright MCP | tool definitions | error: ${(e as Error).message.slice(0, 40)} |`);
    }
  }
  if (bu) log(`| browser-use | system prompt ${fmt(bu.system)} + action schema ${fmt(bu.schema)} | ${fmt(bu.system + bu.schema)} |`);
  if (sh) log(`| Stagehand | act system prompt + instruction template | ${fmt(sh.fixed)} |`);
  defsOurs = ours.t;
  log(`| **WhittleBrowser** | ${ours.n} tool definitions | **${fmt(ours.t)}** |`);
}

// ---------- 5. all-in: what one look at a page really costs ----------
{
  const n = rows.length;
  const img = rows.reduce((a, r) => a + (r.buImg ?? 0), 0);
  log('\n## 5. All-in cost of one look at each page\n');
  log(`Page view + fixed per-call overhead (+ browser-use's default screenshot), summed over the same ${n} pages.\n`);
  log('| tool | page text | screenshots | fixed overhead | **all-in** | WhittleBrowser saves |');
  log('|---|---:|---:|---:|---:|---:|');
  const ab = sum('ours') + n * defsOurs;
  R.fixed = { pw: defsPw, bu: bu ? { system: bu.system, schema: bu.schema } : null, sh: sh?.fixed ?? null, ours: defsOurs };
  R.allin.ours = { text: sum('ours'), img: 0, fixed: n * defsOurs };
  const line = (name: string, text: number, im: number, fixed: number) => {
    const all = text + im + fixed;
    R.allin[name === 'Playwright MCP' ? 'pw' : name === 'browser-use' ? 'bu' : 'sh'] = { text, img: im, fixed };
    log(`| ${name} | ${fmt(text)} | ${im ? fmt(im) : '–'} | ${fmt(fixed)} | **${fmt(all)}** | ${pct(all, ab)} |`);
  };
  if (defsPw) line('Playwright MCP', sum('pw'), 0, n * defsPw);
  if (bu && complete('bu')) line('browser-use', sum('bu'), img, n * (bu.system + bu.schema));
  if (sh && complete('sh')) line('Stagehand', sum('sh'), 0, n * sh.fixed);
  log(`| **WhittleBrowser** | ${fmt(sum('ours'))} | – | ${fmt(n * defsOurs)} | **${fmt(ab)}** | |`);
}
log('\nNotes: tokens are o200k counts of the exact text each tool builds (no LLM calls). Screenshots use Claude\'s ≈ width×height/750 rule. browser-use and Stagehand task totals are modeled from measured page sizes; the article task under-counts browser-use, whose extract action sends the page markdown in a separate call. Versions: Playwright MCP latest, browser-use 0.13.11, Stagehand 4.2.1.');

await b.close();
await srv.close();
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'latest.json'), JSON.stringify(R, null, 1));
// The website and docs charts read this copy.
writeFileSync(join(here, '../../../docs/benchmark.json'), JSON.stringify(R, null, 1));
writeFileSync(join(here, 'results', 'latest.md'), `# Benchmark ${new Date().toISOString().slice(0, 10)}\n\n${out.join('\n')}\n`);
process.exit(0);
