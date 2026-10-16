# Benchmark

How many tokens does a browser agent spend to see a page, and what leaks to the model? We ran **WhittleBrowser**, **Playwright MCP**, **browser-use** and **Stagehand** on the same pages in the same browser and counted exactly what each sends to the LLM.

> Including fixed per-call overhead, WhittleBrowser used **93% fewer tokens than Playwright MCP, 85% fewer than browser-use and 91% fewer than Stagehand**, and it was the only one of the four that let none of the planted secrets or hidden injections through.

<figure class="chart" data-chart="allin" data-src="../data/bench.json" data-title="All-in tokens for one look at each of 11 pages">
<figcaption>What one look at a page really costs</figcaption>
<p class="chart-desc">Page text + fixed per-call overhead + browser-use's default screenshot, summed over 11 pages.</p>
<div class="chart-plot"></div><small class="chart-date"></small>
</figure>

## Results at a glance

| | Playwright MCP | browser-use | Stagehand | WhittleBrowser |
|---|---:|---:|---:|---:|
| Page text, 11 pages | 301,165 | 30,682 | 260,251 | **13,534** |
| All-in, 11 pages | 342,382 | 167,907 | 267,632 | **24,809** |
| Fixed overhead per call | 3,747 | 11,007 | 671 | **1,025** |
| Planted secrets reaching the model (of 7) | 7 | 6 | 6 | **0** |
| Hidden injections reaching the model (of 5) | 5 | 3 | 4 | **0** |

## How it was tested

**Same pages, same browser.** Every tool loads the same 11 URLs in the same Chromium build (Playwright's Chrome for Testing) at a 1280×860 viewport:

- 5 local test pages: a shipping form, a React-style to-do app that re-renders, a catalog with 30 product cards and a 120-row table, a 40-paragraph article, and a page with prompt-injection text.
- 6 live sites: Wikipedia (Pancake), Hacker News, a GitHub repository, MDN `<input>`, BBC News, Python asyncio docs.

**Each tool's own code, no re-implementation:**

| Tool | What we capture | How |
|---|---|---|
| Playwright MCP | the page snapshot it returns after every tool call | `page.ariaSnapshot({ mode: 'ai' })`, the same call Playwright MCP makes |
| browser-use 0.13.11 | the full per-step user message | `BrowserSession.get_browser_state_summary()` → `AgentMessagePrompt.get_user_message()` (`bench/compare/bu_measure.py`) |
| Stagehand 4.2.1 | the hybrid accessibility tree that `act`/`observe`/`extract` send | `page.snapshot()` (`bench/compare/stagehand/sh_measure.mjs`) |
| WhittleBrowser | the `observe` result | MCP `Session.observe()` |

**Exact text, counted.** No LLM is called. We capture the exact text each tool would send and count it with the **o200k_base** tokenizer, as a model-neutral proxy. The only estimate is screenshot tokens for browser-use (vision is on by default), at Claude's rule of about width × height / 750 ≈ 1,468 tokens per 1280×860 screenshot.

**Fixed overhead** is what every call carries besides the page: tool definitions for MCP servers, the system prompt plus action schema for browser-use (5,242 + 5,765), and the act system prompt and instruction template for Stagehand (rebuilt from its own prompt builders). Prompt caching lowers the price of repeats, but they still occupy the context window.

**Multi-step tasks.** Playwright MCP and WhittleBrowser are measured by running each task end to end. browser-use and Stagehand are **modeled** from their measured page sizes and how they call the model:

- **browser-use** sends the full state on every agent step: up to 5 actions per step, but a step ends when the page changes.
- **Stagehand** sends the page tree on every `act` or `extract` call.

**Safety.** A page with 7 planted secrets (a test card number, three API keys, a JWT, an SSN, and a password inside a field) and a page with 5 hidden prompt injections (white-on-white, 1px font, off-screen, `aria-hidden`, `opacity: 0`). We count how many reach the text each tool sends.

## Page by page

<figure class="chart" data-chart="pages" data-src="../data/bench.json" data-title="Tokens per page view, log scale">
<figcaption>Tokens for one page view (page text only, log scale)</figcaption>
<p class="chart-desc">The green dot is WhittleBrowser; grey markers are the other tools. Hover a row for exact numbers.</p>
<div class="chart-plot"></div>
</figure>

| Page | Playwright MCP | browser-use | Stagehand | WhittleBrowser |
|---|---:|---:|---:|---:|
| shipping.html | 457 | 409 | 478 | **204** |
| spa.html | 2,080 | 1,553 | 2,402 | **392** |
| table.html | 9,386 | 960 | 8,431 | **502** |
| article.html | 2,523 | 1,754 | 2,864 | **451** |
| injection.html | 204 | 257 | 247 | **146** |
| wikipedia: Pancake | 68,187 | 4,057 | 51,867 | **1,060** |
| Hacker News | 13,627 | 5,939 | 9,122 | **2,881** |
| GitHub repo | 20,350 | 8,291 | 19,873 | **2,849** |
| MDN <input> | 166,541 | 3,732 | 149,160 | **1,449** |
| BBC News | 12,156 | 2,033 | 9,723 | **2,048** |
| Python docs | 5,654 | 1,697 | 6,084 | **1,552** |
| **Total** | **301,165** | **30,682** | **260,251** | **13,534** |

browser-use's page text is the leanest of the three competitors. It keeps mostly interactive elements and nearby text, then adds a screenshot and a large fixed prompt on every step. On two text-heavy pages (BBC News, Python docs) its page text is about the same size as ours. WhittleBrowser's advantage there comes from the fixed overhead and screenshots, not the page text.

## Across a whole task

<figure class="chart" data-chart="tasks" data-src="../data/bench.json" data-title="Tokens across multi-step tasks">
<figcaption>Page text sent over a full task</figcaption>
<p class="chart-desc">WhittleBrowser batches steps and gets back diffs instead of the whole page.</p>
<div class="chart-plot"></div>
</figure>

| Task | Steps | Playwright MCP | browser-use (modeled) | Stagehand (modeled) | WhittleBrowser |
|---|---:|---:|---:|---:|---:|
| fill shipping form + submit | 7 | 3,167 | 1,024 | 2,868 | **505** |
| todo: tick 3 items, load more | 5 | 10,675 | 7,765 | 9,608 | **684** |
| catalog: find Widget 27, add to cart | 3 | 9,400 | 1,920 | 8,431 | **742** |
| read article (first 2 sections) | 1 | 2,523 | 1,754 | 2,864 | **1,924** |

The article task asks for the full text of two sections, so WhittleBrowser returns the article's content (about 1.9k tokens). The browser-use model counts only one page state there, which under-counts it: its `extract` action sends the page markdown in a separate call.

## All-in cost

| Tool | Page text | Screenshots | Fixed overhead | All-in | WhittleBrowser saves |
|---|---:|---:|---:|---:|---:|
| Playwright MCP | 301,165 | – | 41,217 | **342,382** | 93% |
| browser-use | 30,682 | 16,148 | 121,077 | **167,907** | 85% |
| Stagehand | 260,251 | – | 7,381 | **267,632** | 91% |
| **WhittleBrowser** | 13,534 | – | 11,275 | **24,809** |  |

## Safety

<figure class="chart" data-chart="safety" data-src="../data/bench.json" data-title="Safety checks">
<figcaption>What reaches the model</figcaption>
<p class="chart-desc">Filled dots reached the model.</p>
<div class="chart-plot"></div>
</figure>

WhittleBrowser also flags visible instruction-like text with ⚠ and auto-pauses on payment pages; none of the other tools do either.

## With a real agent

The page-view numbers above leave one question open: does a model still finish the task with a smaller view, and what does a finished task cost? We ran **Claude Code as the agent** (`claude -p`, built-in tools off, a short system prompt) with each browser tool attached as an MCP server, on **Haiku and Sonnet**, 7 tasks × 4 tools × 3 repetitions = 168 runs. Every answer is scored automatically.

**Tasks.** Four local pages: find two prices in the 30-card catalog and 120-row table, count the 40 paragraphs of the article, fill the shipping form and place the order, and tick three boxes on the re-rendering to-do list then read its render counter. Three live pages on toscrape.com: the cheapest Travel book, the number of five-star Mystery books across two pages, and log in then read a quote on page 2.

**What each arm is.**

| Arm | How it was driven |
|---|---|
| WhittleBrowser | its MCP server (`--risk auto`, headless) |
| Playwright MCP | `@playwright/mcp`, snapshot after every call |
| browser-use | `browser-use --mcp` direct-control tools. Its two tools that call a second LLM are disabled. |
| Stagehand | a thin MCP shim over Stagehand's own `page.snapshot()` tree (`bench/agent/stagehand-mcp.mjs`). This is **not** Stagehand's own agent loop, which needs its own model key. |

### haiku (OpenAI estimate priced as gpt-6-luna)

| arm | passed | mean tokens / run | vs Playwright MCP | mean tool calls | mean turns | mean cost (Claude list) | mean cost (OpenAI est.) | mean time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| WhittleBrowser | 21/21 | 28,161 | −47% | 5.8 | 6.8 | $0.0018 | $0.0013 | 13s |
| WhittleBrowser (before fix) | 21/21 | 39,043 | −27% | 6.8 | 7.8 | $0.0021 | $0.0015 | 15s |
| Playwright MCP | 21/21 | 53,371 | – | 6.1 | 7.1 | $0.0022 | $0.0016 | 16s |
| browser-use | 20/21 | 87,351 | +64% | 11.3 | 12.3 | $0.0047 | $0.0031 | 36s |
| Stagehand | 18/21 | 27,208 | −49% | 5.8 | 6.8 | $0.0024 | $0.0015 | 15s |

### sonnet (OpenAI estimate priced as gpt-6.1-sol)

| arm | passed | mean tokens / run | vs Playwright MCP | mean tool calls | mean turns | mean cost (Claude list) | mean cost (OpenAI est.) | mean time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| WhittleBrowser | 21/21 | 19,943 | −31% | 4.1 | 5.1 | $0.0207 | $0.0159 | 16s |
| WhittleBrowser (before fix) | 21/21 | 33,817 | +17% | 6.0 | 7.0 | $0.0309 | $0.0220 | 22s |
| Playwright MCP | 18/21 | 28,890 | – | 3.9 | 4.9 | $0.0169 | $0.0146 | 38s |
| browser-use | 21/21 | 36,022 | +25% | 7.2 | 8.2 | $0.0477 | $0.0309 | 28s |
| Stagehand | 21/21 | 25,005 | −13% | 6.2 | 7.2 | $0.0369 | $0.0255 | 24s |

### Pass rate and mean tokens per task (all models)

| task | WhittleBrowser | WhittleBrowser (before fix) | Playwright MCP | browser-use | Stagehand |
|---|---:|---:|---:|---:|---:|
| table | 6/6 · 24,637 | 6/6 · 25,182 | 5/6 · 20,921 | 6/6 · 26,566 | 6/6 · 14,899 |
| form | 6/6 · 19,600 | 6/6 · 19,641 | 6/6 · 46,132 | 6/6 · 147,439 | 6/6 · 17,770 |
| article | 6/6 · 12,975 | 6/6 · 11,386 | 6/6 · 24,716 | 6/6 · 13,846 | 6/6 · 9,702 |
| spa | 6/6 · 22,869 | 6/6 · 27,377 | 4/6 · 97,069 | 6/6 · 105,754 | 6/6 · 24,450 |
| books-cheapest | 6/6 · 30,306 | 6/6 · 23,907 | 6/6 · 27,192 | 6/6 · 33,342 | 6/6 · 26,051 |
| books-five-star | 6/6 · 39,195 | 6/6 · 127,869 | 6/6 · 31,966 | 6/6 · 54,004 | 3/6 · 73,337 |
| quotes-login | 6/6 · 18,781 | 6/6 · 19,649 | 6/6 · 39,919 | 5/6 · 50,854 | 6/6 · 16,537 |

### Cost of one pass over the battery (7 tasks)

| arm | haiku (Claude list) | sonnet (Claude list) | haiku → gpt-6-luna (est.) | sonnet → gpt-6.1-sol (est.) |
|---|---:|---:|---:|---:|
| WhittleBrowser | $0.0127 | $0.145 | $0.0090 | $0.112 |
| WhittleBrowser (before fix) | $0.0149 | $0.216 | $0.0104 | $0.154 |
| Playwright MCP | $0.0153 | $0.119 | $0.0110 | $0.102 |
| browser-use | $0.0332 | $0.334 | $0.0220 | $0.216 |
| Stagehand | $0.0170 | $0.259 | $0.0108 | $0.179 |

**Reading the numbers.**

- Success is close to level. WhittleBrowser finished all 42 runs; the misses were Playwright MCP on two `spa` runs and one `table` run, Stagehand on three `books-five-star` runs, and browser-use on one login run.
- Where pages are big or re-render, a small view helps a lot: on `spa` WhittleBrowser used about 23k tokens against 97k for Playwright MCP and 106k for browser-use, and on `form` about 20k against 46k and 147k.
- Where pages are small, the savings mostly disappear. Tool definitions and the model's own turns dominate, and on short tasks (`table`, `books-cheapest`) all four tools are within a few thousand tokens of each other.
- **Stagehand was about level with WhittleBrowser** (27k against 28k on Haiku, 25k against 20k on Sonnet), so the 91% page-view gap above does not carry over to whole tasks on pages this size. We have not isolated why. This arm leaves out Stagehand's own agent prompts and exposes 8 small tools, and the model usually needed only one snapshot, so it probably flatters Stagehand.
- **`books-five-star` exposed a gap, which we then fixed.** A star rating is a CSS class, so no tool's text view shows it. Playwright MCP has a JavaScript evaluate tool and counted the elements in 2 to 6 calls; WhittleBrowser had no equivalent and took 15 to 20 screenshots, about 128k tokens against 32k. We added two things: text-less rating elements now show as `rating 5/5` in the page view, and `find css:SELECTOR` counts visible matches and lists their class and attributes without running any script. After that WhittleBrowser took 4 to 15 calls and about 39k tokens on this task, still above Playwright MCP's 32k. The "before fix" rows keep the old numbers for comparison.
- The other tasks also moved between the two WhittleBrowser runs (for example `spa` 27k to 23k), and the same code ran in both, so with 3 repetitions differences of that size are noise. Only the `books-five-star` change is large enough to be the fix.
- On Sonnet WhittleBrowser now uses fewer tokens than Playwright MCP (20k against 29k per run) but still costs more per pass ($0.145 against $0.119 on Claude list prices). We have not isolated why; the cache-read versus cache-write mix is a likely part of it.

**What the OpenAI columns mean.** They re-price the same measured tokens at OpenAI list prices (gpt-6-luna for the Haiku runs, gpt-6.1-sol for the Sonnet runs; $0.10 / $0.01 cached / $0.50 and $2 / $0.10 cached / $10 per 1M tokens, from developers.openai.com/api/docs/pricing). They are an estimate of what this battery would cost on OpenAI, not a measurement: a different model uses a different tokenizer and takes a different number of turns.

## Limits of this benchmark

- The page-view tables measure **input size and leaks** with no model. The agent section adds success and cost, but only for Claude (Haiku and Sonnet), 7 tasks and 3 repetitions each, so one slow run moves an average. A larger run with more models (for example, WebVoyager tasks) is on the [roadmap](roadmap.html).
- Token counts use one tokenizer; real counts vary a little by model.
- browser-use and Stagehand task totals are modeled; page sizes and safety numbers are measured.
- Live sites change daily, so numbers drift between runs. The JSON with every number is in `docs/benchmark.json`.

## Reproduce it

```bash
packages/engine/bench/compare/setup.sh   # once: browser-use (uv venv) and Stagehand (npm)
pnpm bench -- --live --pw-mcp            # writes bench/results/latest.md and docs/benchmark.json
pnpm bench:agent --models haiku,sonnet --reps 3   # agent run, needs the claude CLI; then: pnpm tsx bench/agent/summarize.ts
```
