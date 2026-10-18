#!/usr/bin/env node
// Thin MCP shim over Stagehand's own page primitives, so Claude Code can be the agent without a second LLM.
// Stagehand's real agent loop needs its own model API key; here the model only sees what Stagehand puts in
// front of its LLM: page.snapshot().formattedTree (the hybrid accessibility tree behind act/observe/extract).
// Actions return a short "ok"; the model calls `snapshot` when it wants to look, like Stagehand's observe.
//   node stagehand-mcp.mjs --exe <chromium path>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Stagehand, localBrowser } = await import(pathToFileURL(join(here, '../compare/stagehand/node_modules/@browserbasehq/stagehand/dist/index.mjs')).href);
const exe = process.argv[process.argv.indexOf('--exe') + 1];

let sh, page, xpaths = {};
const ready = async () => {
  if (page) return page;
  const browser = await localBrowser.launch({ executablePath: exe, headless: true, viewport: { width: 1280, height: 860 } });
  sh = await Stagehand.create({ browser });
  page = (await sh.browser.context.pages())[0] || (await sh.browser.context.newPage());
  return page;
};
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const target = async (id) => {
  const p = await ready();
  const xp = xpaths[id];
  if (!xp) throw new Error(`unknown id ${id}; call snapshot first`);
  return p.locator(xp.startsWith('/') ? `xpath=${xp}` : xp);
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const server = new McpServer({ name: 'stagehand', version: '0.0.0' });
server.tool('navigate', 'Go to a URL', { url: z.string() }, async ({ url }) => {
  const p = await ready();
  await p.goto(url).catch((e) => { throw new Error(String(e.message || e).slice(0, 200)); });
  await settle();
  return text(`ok ${url}`);
});
server.tool('snapshot', 'Accessibility tree of the current page; ids like 0-12 are used by click/fill', {}, async () => {
  const p = await ready();
  const snap = await p.snapshot({ timeout: 30_000 });
  xpaths = snap.xpathMap;
  return text(snap.formattedTree);
});
server.tool('click', 'Click the element with this id from the last snapshot', { id: z.string() }, async ({ id }) => {
  await (await target(id)).click();
  await settle();
  return text('ok');
});
server.tool('fill', 'Fill an input with text', { id: z.string(), text: z.string() }, async ({ id, text: t }) => {
  await (await target(id)).fill(t);
  return text('ok');
});
server.tool('select', 'Choose an option (by label) in a <select>', { id: z.string(), option: z.string() }, async ({ id, option }) => {
  const p = await ready();
  const xp = xpaths[id];
  await p.evaluate(`(() => { const r = document.evaluate(${JSON.stringify(xp)}, document, null, 9, null).singleNodeValue; if (!r) return; const o = [...r.options].find((o) => o.text.trim() === ${JSON.stringify(option)}); if (o) { r.value = o.value; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  return text('ok');
});
server.tool('press', 'Press a key such as Enter', { key: z.string() }, async ({ key }) => {
  await (await ready()).keyPress(key);
  await settle();
  return text('ok');
});
server.tool('scroll', 'Scroll the page up or down by one screen', { direction: z.enum(['up', 'down']) }, async ({ direction }) => {
  await (await ready()).scroll(640, 430, 0, direction === 'down' ? 800 : -800);
  return text('ok');
});
server.tool('back', 'Go back in history', {}, async () => {
  await (await ready()).evaluate('history.back()');
  await settle();
  return text('ok');
});
await server.connect(new StdioServerTransport());
const bye = async () => { await sh?.close?.().catch(() => {}); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye); process.stdin.on('close', bye);
