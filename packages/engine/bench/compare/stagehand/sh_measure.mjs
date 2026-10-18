// Measure what Stagehand sends to the model per act/observe call, using Stagehand's own code:
// page.snapshot() returns the hybrid accessibility tree that act/observe/extract put in the prompt.
// Fixed per-call text (act system prompt + act instruction template) is taken from the prompt
// builders shipped in Stagehand's runtime. No LLM is called. Tokens: o200k_base.
// usage: node sh_measure.mjs <chromium-executable> <url> [<url> ...]   -> JSON on stdout
import { readFileSync } from 'node:fs';
import { Stagehand, localBrowser } from '@browserbasehq/stagehand';
import { getEncoding } from 'js-tiktoken';

const enc = getEncoding('o200k_base');
const tok = (s) => enc.encode(s).length;
const [exe, ...urls] = process.argv.slice(2);

// Rebuild the act prompt with Stagehand's real builder functions.
const sw = readFileSync(new URL('./node_modules/@browserbasehq/stagehand/dist/extension/service-worker.js', import.meta.url), 'utf8');
const grab = (name) => sw.slice(sw.indexOf(`function ${name}(`), sw.indexOf('\nfunction ', sw.indexOf(`function ${name}(`) + 10));
const builders = new Function(`const buildUserInstructionsString = () => ''; const getVariablePromptEntries = () => [];
  ${grab('buildActVariablesPrompt')}\n${grab('buildActSystemPrompt')}\n${grab('buildActPrompt')}
  return { buildActSystemPrompt, buildActPrompt };`)();
const actions = ['click', 'fill', 'type', 'press', 'scrollTo', 'nextChunk', 'prevChunk', 'selectOptionFromDropdown', 'hover', 'doubleClick', 'dragAndDrop'];
const fixed = tok(builders.buildActSystemPrompt().content) + tok(builders.buildActPrompt('click the Continue button', actions)) + tok('instruction: \nAccessibility Tree: \n');

const browser = await localBrowser.launch({ executablePath: exe, headless: true, viewport: { width: 1280, height: 860 } });
const sh = await Stagehand.create({ browser });
const page = (await sh.browser.context.pages())[0] || (await sh.browser.context.newPage());
const out = { fixed, pages: [] };
for (const url of urls) {
  try {
    const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms));
    await Promise.race([page.goto(url).catch(() => {}), limit(30_000, 'goto')]);
    await new Promise((r) => setTimeout(r, 1200));
    const snap = await Promise.race([page.snapshot({ timeout: 30_000 }), limit(40_000, 'snapshot')]);
    const row = { url, tree: tok(snap.formattedTree) };
    if (/canary|injection/.test(url)) row.text = snap.formattedTree; // safety checks
    out.pages.push(row);
  } catch (e) {
    out.pages.push({ url, error: String(e.message || e).slice(0, 200) });
  }
}
process.stderr.write(`done ${out.pages.length} pages\n`);
console.log(JSON.stringify(out));
await sh.close?.().catch?.(() => {});
await browser.close?.().catch?.(() => {});
process.exit(0);
