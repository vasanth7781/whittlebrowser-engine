// Builds website/dist: copies the landing page and renders ../docs/*.md into a docs site.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';

const here = import.meta.dirname;
const dist = join(here, 'dist');
const docsSrc = join(here, '..', 'docs');
rmSync(dist, { recursive: true, force: true });
cpSync(join(here, 'src'), dist, { recursive: true });

// order, slug, source file, sidebar group
const DOCS = [
  ['index', 'introduction.md', 'Start'],
  ['getting-started', 'getting-started.md', 'Start'],
  ['claude-code', 'claude-code.md', 'Start'],
  ['use-with-ai-tools', 'use-with-ai-tools.md', 'Start'],
  ['how-it-works', 'how-it-works.md', 'Concepts'],
  ['protocol', 'PROTOCOL.md', 'Concepts'],
  ['control', 'CONTROL.md', 'Concepts'],
  ['safety', 'safety.md', 'Concepts'],
  ['messy-pages', 'messy-pages.md', 'Concepts'],
  ['chat', 'chat.md', 'Features'],
  ['xray-and-cursor', 'xray-and-cursor.md', 'Features'],
  ['research', 'research.md', 'Features'],
  ['studio', 'studio.md', 'Features'],
  ['benchmark', 'BENCHMARK.md', 'Results'],
  ['comparison', 'GAPS.md', 'Results'],
  ['faq', 'faq.md', 'Results'],
  ['roadmap', 'ROADMAP.md', 'Results'],
];
const linkMap = Object.fromEntries(DOCS.map(([slug, file]) => [file, slug + '.html']));
const pages = DOCS.map(([slug, file, group]) => {
  let md = readFileSync(join(docsSrc, file), 'utf8');
  md = md.replace(/\]\(([A-Za-z-]+\.md)(#[^)]*)?\)/g, (m, f, h = '') => `](${linkMap[f] || f}${h})`);
  const SHORT = { comparison: 'Gaps & comparison', 'xray-and-cursor': 'X-ray & human cursor', 'messy-pages': 'Pages without semantic tags', roadmap: 'Roadmap & tool pack' };
  const title = SHORT[slug] || (md.match(/^# (.+)$/m) || [, slug])[1].replace(/^Benchmark .*/, 'Benchmark');
  // Headings get ids so docs can link to sections (getting-started.html#everyday-browser-features).
  const html = marked.parse(md).replace(/<h([23])>(.+?)<\/h\1>/g, (_m, n, inner) => `<h${n} id="${inner.replace(/<[^>]+>/g, '').toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}">${inner}</h${n}>`);
  return { slug, group, title, html };
});

const shell = (p, i) => {
  const groups = [...new Set(DOCS.map((d) => d[2]))];
  const nav = groups.map((g) => `<div class="sg"><b>${g}</b>${pages.filter((x) => x.group === g).map((x) => `<a href="${x.slug}.html"${x === p ? ' class="on"' : ''}>${x.title}</a>`).join('')}</div>`).join('');
  const prev = pages[i - 1], next = pages[i + 1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title} · WhittleBrowser docs</title><link rel="icon" href="../assets/favicon.svg"><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../docs.css"></head>
<body class="docs"><header class="nav"><a class="brand" href="../"><span class="logo"></span>WhittleBrowser</a><nav><a href="../#how">How it works</a><a href="../#compare">Compare</a><a href="./" class="cur">Docs</a></nav><a class="btn small" href="getting-started.html">Get started</a></header>
<div class="dwrap"><aside class="side-nav">${nav}</aside><main class="prose">${p.html}
${p.html.includes('class="chart"') ? '<script type="module" src="../charts.js"></script>' : ''}
<div class="pn">${prev ? `<a href="${prev.slug}.html"><small>Previous</small>${prev.title}</a>` : '<span></span>'}${next ? `<a class="nx" href="${next.slug}.html"><small>Next</small>${next.title}</a>` : ''}</div></main></div></body></html>`;
};
mkdirSync(join(dist, 'docs'), { recursive: true });
mkdirSync(join(dist, 'data'), { recursive: true });
cpSync(join(docsSrc, 'benchmark.json'), join(dist, 'data', 'bench.json'));
pages.forEach((p, i) => writeFileSync(join(dist, 'docs', p.slug + '.html'), shell(p, i)));

// Legal pages (website/legal/*.md → dist/legal/*.html). They belong to the commercial Cloud service and live in its repo;
// copy them into website/legal to publish them with this site. Skipped when the folder is absent.
const LEGAL = [
  ['terms', 'Terms of Service'],
  ['privacy', 'Privacy Policy'],
  ['acceptable-use', 'Acceptable Use Policy'],
  ['refunds', 'Refund Policy'],
];
const hasLegal = existsSync(join(here, 'legal'));
if (hasLegal) mkdirSync(join(dist, 'legal'), { recursive: true });
for (const [slug, title] of hasLegal ? LEGAL : []) {
  const html = marked.parse(readFileSync(join(here, 'legal', slug + '.md'), 'utf8'));
  const nav = LEGAL.map(([s, t]) => `<a href="${s}.html"${s === slug ? ' class="on"' : ''}>${t}</a>`).join('');
  writeFileSync(join(dist, 'legal', slug + '.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · WhittleBrowser</title><link rel="icon" href="../assets/favicon.svg"><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../docs.css"></head>
<body class="docs"><header class="nav"><a class="brand" href="../"><span class="logo"></span>WhittleBrowser</a><nav><a href="../#how">How it works</a><a href="../docs/">Docs</a></nav><a class="btn small" href="../docs/getting-started.html">Get started</a></header>
<div class="dwrap"><aside class="side-nav"><div class="sg"><b>Legal</b>${nav}</div></aside><main class="prose">${html}</main></div></body></html>`);
}
console.log(`site built: ${pages.length} docs pages, ${hasLegal ? LEGAL.length : 0} legal pages → ${dist}`);
