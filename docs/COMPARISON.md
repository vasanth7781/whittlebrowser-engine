# Comparison: common problems in agent browsers, and what the engine does

Each problem below is one that Playwright MCP, browser-use, Stagehand and AI browsers (Comet, Atlas and others) are reported to have, with what this engine does about it and how that is verified. Numbers come from [BENCHMARK.md](BENCHMARK.md), which measures the four tools on the same pages.

| # | Problem | What the engine does | How it is verified |
|---|---|---|---|
| 1 | **Token bloat.** Playwright MCP returns a full accessibility snapshot on every call (12–14k input tokens per step; 68k on one Wikipedia page, 166k on MDN). Screenshot-first agents spend ~45× more than API agents. | Compact line format, generic wrappers flattened, repeated siblings folded, label text deduplicated, a token budget with graceful degradation (shorter text, harder folding, off-screen summaries, then a cut). | 96% fewer tokens per observation across 11 pages (300k → 13k) |
| 2 | **Re-reading the page after every action.** Context grows ~0.5–1.8k tokens per step. | After an action the model gets an outcome line plus a **diff** (`~` changed, `+` added, `−` removed, `@` context). Steps can be **batched** (fill a whole form in one call). | 85% fewer tokens across multi-step tasks |
| 3 | **Tool-definition overhead** is paid on every request (25 tools ≈ 3.7k tokens). | 9 tools with short schemas, plus server instructions sent once. | 947 vs 3,747 tokens |
| 4 | **Refs break on re-render.** React/Vue replace nodes, so refs go stale and actions fail. | Refs carry a fingerprint (role + name + occurrence). A re-created node gets the **same ref**, and stale refs are remapped before acting. | Tested: same ref still works after a full DOM re-render |
| 5 | **Silent failures.** Clicks land on overlays and agents can't tell what happened. | Hit-testing before every click (`covered by dialog "Cookies"`), plus outcome reports: navigation, new tab, dialogs, downloads, and validation states. | Tested |
| 6 | **Indirect prompt injection.** Hidden page text hijacks agents (PleaseFix, CometJacking, Tainted Memories, HashJack). | The in-page agent **drops hidden and deceptive text** (display:none, sr-only, off-document, opacity 0, 1px fonts, white-on-white). Visible instruction-like lines are marked ⚠, and the page is flagged when removed hidden text contained instructions. | 5 of 5 hidden injections blocked (Playwright MCP: 0 of 5) |
| 7 | **Page scripts can tamper with the agent.** The agent's code runs in the page's world. | The agent runs in a **CDP isolated world**: pages can't monkey-patch its DOM APIs or see its refs. | Tested: the fixture overrides `getBoundingClientRect` and `getComputedStyle`, and the agent is unaffected |
| 8 | **Secrets leak to the LLM.** Card numbers, API keys, passwords and OTPs end up in snapshots. | Sensitive field values are masked **inside the page**. A single choke point scrubs keys, cards (Luhn), JWTs, SSNs and IBANs into reversible `‹kind:n›` tokens. Vault refs (`secret:NAME`) are resolved locally. Screenshots blur sensitive fields. | 0 of 7 planted secrets leaked (Playwright MCP: 7 of 7) |
| 9 | **No consent model for AI on sensitive sites.** | With a host app that owns the policy, AI is **off per site by default** with Off/Ask/Allowed (`--default-off` does the same standalone). Banks, cloud consoles, password managers, card/ID/API-key fields and key pages trigger **auto-pause** and nothing is sent. The user can override per site. | Policy and auto-pause tested in the engine |
| 10 | **Irreversible actions run unchecked.** | Risk classifier for pay, order, delete, send, publish, transfer, grant and similar. A host app asks the user; headless agents must re-issue with `confirm:true`. `confirm()` dialogs are dismissed unless confirmed. | Tested in the engine |
| 11 | **Cross-site exfiltration** (agent sends data from site A to site B). | Agent-initiated jumps to another origin with a long query string need approval. URL query values are never shown in full. Uploads outside a sandbox dir need approval. | Implemented |
| 12 | **Bot detection arms race.** Stealth plugins and CAPTCHA solvers are ToS violations. | **Honest identity:** User-Agent token, Web Bot Auth (RFC 9421 Ed25519 signatures, Cloudflare verified agents), robots.txt check, and a **CAPTCHA handoff** (`wait {user}`) where the human solves it in the same window. No fingerprint spoofing and no solvers. | Signatures verified in tests |
| 13 | **Reading wastes tokens.** Agents read whole pages to find one thing. | `find` greps the whole page (including off-screen) and ranks hits. Typed extractors: `table` (paged), `list` (repeated cards become rows, no LLM needed), `text` (main content as markdown, boilerplate removed, paged). | Tested |
| 14 | **div-onClick apps and div modals are invisible** to accessibility-tree tools. | A main-world handler probe (`getEventListeners`, React `onClick` props) gives elements a `clickable` role, and layout and naming infer header/nav/aside/footer/main/dialog/menu. Icon-only controls get names from title/alt/icon class/href (`upvote`, `close`). Custom checkboxes are surfaced through their labels. | Tested on fixtures and HN/GitHub |
| 15 | **Nondeterministic, unmeasured agents.** | A benchmark against Playwright MCP (tokens, leaks, injections, tool defs) plus a canary leak test in CI. The session trace records tokens and latency per call. | `pnpm bench` |

## Current limitations

- **Cross-origin iframes:** listed as `iframe "host" cross-origin`, contents not expanded.
- **Replay:** the trace is recorded, but a workflow cannot be replayed without a model.
- **Closed shadow roots, canvas-only apps and unrendered rows of virtualized lists** are not visible.
- **Success rate:** measured only for Claude (Haiku and Sonnet) on 7 tasks; see the [benchmark](BENCHMARK.md).

## Sources

- [Why does Playwright MCP use so many tokens?](https://itnext.io/why-does-playwright-mcp-use-so-many-tokens-da56b6dbd2db)
- [Browser Use vs Playwright MCP vs Stagehand](https://pub.towardsai.net/browser-use-vs-playwright-mcp-vs-stagehand-the-106k-star-winner-just-ditched-its-own-framework-a226447da96d)
- [Stop burning tokens: browser AI 45× cost](https://www.baytechconsulting.com/blog/stop-burning-tokens-browser-ai-45x-cost)
- [Why token usage explodes in browser agents](https://anchorbrowser.io/blog/why-token-usage-explodes-in-browser-agents)
- [CSA research note: PleaseFix agentic browser exploits](https://labs.cloudsecurityalliance.org/research/csa-research-note-pleasefix-agentic-browser-exploits-2026032/)
- [Agentic browsers and the Same-Origin Policy (UW)](https://agent-security.cs.washington.edu/agentic_browsers_sop.html)
- [Comet prompt injection vulnerabilities](https://ppc.land/comet-browser-faces-multiple-security-vulnerabilities-from-prompt-injection/)
- [Atlas prompt injection flaw](https://bdtechtalks.substack.com/p/what-openai-atlas-prompt-injection)
