#!/usr/bin/env node
/**
 * Draws the README benchmark charts as static SVG (GitHub does not run scripts in a README).
 * Reads the committed results, so the pictures cannot drift from the tables:
 *   docs/benchmark.json                          page-view benchmark (no model)
 *   packages/engine/bench/agent/results/summary.json   real-agent runs (pnpm tsx bench/agent/summarize.ts)
 * Writes docs/img/benchmark-pages-{light,dark}.svg and docs/img/benchmark-agent-{light,dark}.svg.
 *
 *   pnpm bench:charts          rewrite the files
 *   import { build } from './charts.mjs'    returns { filename: svgText } without writing (the docs test uses this)
 *
 * Design: one accent bar for WhittleBrowser, the other tools in a recessive gray (emphasis), every bar labelled
 * with its tool and value so no meaning rests on colour, thin bars with a 4px rounded data end on a square baseline.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');

const THEMES = {
  light: { surface: '#fcfcfb', border: 'rgba(11,11,11,0.10)', ink: '#0b0b0b', ink2: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7', accent: '#2a78d6', other: '#898781' },
  dark: { surface: '#1a1a19', border: 'rgba(255,255,255,0.10)', ink: '#f0efec', ink2: '#c3c2b7', grid: '#2c2c2a', axis: '#383835', accent: '#3987e5', other: '#898781' },
};
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const TOOLS = [
  { key: 'ours', agent: 'whittle', name: 'WhittleBrowser', pages: 'ours' },
  { key: 'pw', agent: 'playwright', name: 'Playwright MCP', pages: 'pw' },
  { key: 'bu', agent: 'browser-use', name: 'browser-use', pages: 'bu' },
  { key: 'sh', agent: 'stagehand', name: 'Stagehand', pages: 'sh' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const compact = (n) => (n >= 100_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pct = (a, b) => Math.round((1 - b / a) * 100);

/** Bar with a square baseline end and a 4px rounded data end. */
function bar(x, y, w, h, fill, tip) {
  const r = Math.min(4, w / 2, h / 2);
  const d = `M${x},${y} h${(w - r).toFixed(1)} a${r},${r} 0 0 1 ${r},${r} v${(h - 2 * r).toFixed(1)} a${r},${r} 0 0 1 ${-r},${r} h${(r - w).toFixed(1)} z`;
  return `<path d="${d}" fill="${fill}"><title>${esc(tip)}</title></path>`;
}

function frame(t, w, h, title, desc, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d" font-family='${FONT}'>
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>
${body}
</svg>
`;
}

const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 13}" font-weight="${o.weight ?? 400}" fill="${o.fill}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;

function key(t, x, y) {
  return `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${t.accent}"/>${text(x + 16, y, 'WhittleBrowser', { size: 12, fill: t.ink2 })}` +
    `<rect x="${x + 124}" y="${y - 9}" width="10" height="10" rx="2" fill="${t.other}"/>${text(x + 140, y, 'other tools', { size: 12, fill: t.ink2 })}`;
}

/** Chart 1: tokens to look at 11 pages, all-in (page text + tool definitions + screenshots). */
function pagesChart(t, bench) {
  const W = 880, left = 32, labelW = 132, x0 = left + labelW, plotW = 560, rowH = 46, top = 112, barH = 22;
  const total = (k) => bench.allin[k].text + bench.allin[k].img + bench.allin[k].fixed;
  const max = 350_000;
  const sx = (v) => (v / max) * plotW;
  const H = top + TOOLS.length * rowH + 62;
  let b = text(left, 36, 'Tokens to look at 11 pages', { size: 18, weight: 600, fill: t.ink });
  b += text(left, 58, 'Page text, tool definitions and screenshots, summed over 11 pages. Fewer is better.', { size: 13, fill: t.ink2 });
  b += key(t, left, 86);
  for (const v of [0, 100_000, 200_000, 300_000]) {
    const x = x0 + sx(v);
    b += `<line x1="${x}" y1="${top - 10}" x2="${x}" y2="${top + TOOLS.length * rowH - 6}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/>`;
    b += text(x, top + TOOLS.length * rowH + 12, v === 0 ? '0' : `${v / 1000}k`, { size: 11.5, fill: t.ink2, anchor: 'middle' });
  }
  TOOLS.forEach((tool, i) => {
    const v = total(tool.pages);
    const y = top + i * rowH;
    const ours = tool.key === 'ours';
    b += text(left + labelW - 12, y + barH / 2 + 4.5, tool.name, { size: 13.5, weight: ours ? 600 : 400, fill: t.ink, anchor: 'end' });
    b += bar(x0, y, sx(v), barH, ours ? t.accent : t.other, `${tool.name}: ${v.toLocaleString('en-US')} tokens`);
    const label = ours ? `${compact(v)}  ·  ${pct(total('pw'), v)}% fewer than Playwright MCP` : compact(v);
    b += text(x0 + sx(v) + 10, y + barH / 2 + 4.5, label, { size: 13, weight: ours ? 600 : 400, fill: t.ink });
  });
  b += text(left, H - 18, 'o200k_base tokens, same pages and Chromium for every tool, no model. Source: docs/BENCHMARK.md', { size: 11.5, fill: t.ink2 });
  const desc = TOOLS.map((tool) => `${tool.name} ${total(tool.pages).toLocaleString('en-US')}`).join('; ');
  return frame(t, W, H, 'Tokens to look at 11 pages', `Bar chart, fewer is better: ${desc}.`, b);
}

/** Chart 2: mean tokens per run in real agent runs, one panel per model. */
function agentChart(t, sum) {
  const W = 880, left = 32, labelW = 132, rowH = 46, top = 142, barH = 22, panelW = 240, max = 100_000;
  const sx = (v) => (v / max) * panelW;
  const panels = [
    { model: 'haiku', title: 'Claude Haiku', x0: left + labelW },
    { model: 'sonnet', title: 'Claude Sonnet', x0: left + labelW + panelW + 112 },
  ];
  const H = top + TOOLS.length * rowH + 74;
  let b = text(left, 36, 'Tokens per finished task, with a real agent', { size: 18, weight: 600, fill: t.ink });
  b += text(left, 58, 'Mean tokens per run. The second number is tasks passed out of 21 (7 tasks × 3 repetitions). Fewer is better.', { size: 13, fill: t.ink2 });
  b += key(t, left, 86);
  const runs = [];
  for (const p of panels) {
    b += text(p.x0, top - 22, p.title, { size: 14, weight: 600, fill: t.ink });
    for (const v of [0, 50_000, 100_000]) {
      const x = p.x0 + sx(v);
      b += `<line x1="${x}" y1="${top - 10}" x2="${x}" y2="${top + TOOLS.length * rowH - 6}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/>`;
      b += text(x, top + TOOLS.length * rowH + 12, v === 0 ? '0' : `${v / 1000}k`, { size: 11.5, fill: t.ink2, anchor: 'middle' });
    }
    TOOLS.forEach((tool, i) => {
      const r = sum.models[p.model][tool.agent];
      const y = top + i * rowH;
      const ours = tool.key === 'ours';
      if (p.model === 'haiku') b += text(left + labelW - 12, y + barH / 2 + 4.5, tool.name, { size: 13.5, weight: ours ? 600 : 400, fill: t.ink, anchor: 'end' });
      b += bar(p.x0, y, sx(r.tokens), barH, ours ? t.accent : t.other, `${tool.name}, ${p.title}: ${Math.round(r.tokens).toLocaleString('en-US')} tokens per run, ${r.passed} of ${r.runs} tasks passed`);
      b += text(p.x0 + sx(r.tokens) + 10, y + barH / 2 + 4.5, `${compact(r.tokens)}  ·  ${r.passed}/${r.runs}`, { size: 13, weight: ours ? 600 : 400, fill: t.ink });
      runs.push(`${p.title} ${tool.name} ${Math.round(r.tokens)} tokens, ${r.passed}/${r.runs} passed`);
    });
  }
  b += text(left, H - 18, 'Claude Code as the agent, built-in tools off. Same tasks and prompt for every tool. Source: docs/BENCHMARK.md', { size: 11.5, fill: t.ink2 });
  return frame(t, W, H, 'Tokens per finished task, with a real agent', `Bar chart per model, fewer is better: ${runs.join('; ')}.`, b);
}

export function build() {
  const bench = JSON.parse(readFileSync(join(repo, 'docs/benchmark.json'), 'utf8'));
  const sum = JSON.parse(readFileSync(join(here, 'agent/results/summary.json'), 'utf8'));
  const out = {};
  for (const [mode, t] of Object.entries(THEMES)) {
    out[`benchmark-pages-${mode}.svg`] = pagesChart(t, bench);
    out[`benchmark-agent-${mode}.svg`] = agentChart(t, sum);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = join(repo, 'docs/img');
  mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(build())) {
    writeFileSync(join(dir, name), svg);
    console.log('wrote docs/img/' + name);
  }
}
