# Roadmap: WhittleBrowser as a tool pack

## How agents and LLMs can use it

| # | Channel | Who it serves | What to build | Effort |
|---|---|---|---|---|
| 1 | **MCP server** (done) | Claude Code/Desktop, Cursor, Codex, VS Code, Windsurf, Zed | Publish to npm under our own scope (the name `whittlebrowser-mcp` is taken by another project) so `npx` just works; one-line configs per client (written: use-with-ai-tools.md) | S |
| 2 | **CLI one-shots** | any agent with a shell (Claude Code Bash, Codex, Aider) | `whittlebrowser observe <url>`, `find`, `extract table`, `research`: compact text on stdout, cheapest integration | S |
| 3 | **Agent Skill** | Claude Skills, Codex/Cursor rules | `SKILL.md` that teaches the efficient pattern (observe once, batch `act`, `find` before reading, `research` for comparisons) and bundles the MCP config | S |
| 4 | **Native tool schemas** | direct API users | Export the 9 tools as Anthropic `tools`, OpenAI function/Responses tools and Gemini function declarations, plus a ~100-line reference agent loop | S |
| 5 | **TypeScript SDK** | app developers | Publish `@whittlebrowser/engine` (`Session`: observe/act/find/extract/research) with typed results | S |
| 6 | **Framework adapters** | LangChain, LlamaIndex, CrewAI, Vercel AI SDK, OpenAI Agents SDK, Claude Agent SDK, Mastra | Thin wrappers over the SDK or MCP | M |
| 7 | **Python package** | Python agent stacks | `pip install whittlebrowser`: client for the MCP/HTTP server, same 9 tools | M |
| 8 | **HTTP/WebSocket API + Docker** | servers, CI, multi-tenant | Headless image with optional live view (VNC/WebRTC), session pool, per-session policy | M |
| 9 | **Chrome extension mode** | people who live in Chrome | Same in-page agent as a content script, so agents can drive the user's real Chrome profile with the AI dot and approvals | L |

## Capabilities worth adding

**Fewer tokens, fewer calls**
- **Recipes and replay:** record a successful run, replay it with zero LLM calls (fingerprint refs self-heal), and export it as a Playwright test.
- **API shortcut:** detect the JSON/GraphQL call behind a page (search results, product lists) and read that instead of the DOM.
- **Schema extract:** `extract {schema}` that fills JSON fields from the list/table extractors and only asks the model for gaps.
- **Cost governor:** a per-task token budget with automatic stop, plus routing (small model for navigation, large for reasoning).

**Reach more of the web**
- Cross-origin iframes (OOPIF), closed shadow roots, canvas apps (cropped vision fallback), virtualized lists (auto-scroll and collect).
- Files: read PDFs and downloads into markdown, upload flows, CSV out.
- Auth: passkeys and 2FA handoff, vault integrations (1Password CLI, macOS Keychain).

**Trust and operations**
- Per-site playbooks and memory: user-visible, origin-scoped and editable, so memory can't be poisoned the way Atlas's was.
- Policy files for teams (allowed domains, PII rules, approval rules), audit log, OpenTelemetry traces.
- Watchers and schedules ("tell me when…") running on sleeping tabs.

**Commercial cloud** (separate proprietary repository)
- Built: own auth, prepaid credits via Polar, hosted sessions, live view with human handoff, saved logins, `/cloud` web app.
- Next: run against Polar sandbox and a Fly staging app; recordings; Slack/webhook alerts; per-session network isolation; SOC 2 path; account export and deletion.

**Make the safety heuristics less brittle** (from the regex and static-list review)
- [ ] **Multi-signal risk classifier** (`core/risk.ts`): today a click is "high risk" only if its text matches one English regex. Keep the regex as one weak signal and add: `type=submit` inside a form with card/password/amount fields, form action and method, `autocomplete=cc-*` on the page, `aria-label`/`title` for icon-only buttons, URL path (`/checkout`, `/delete`, `/billing`), and page title. When signals are missing or disagree, ask instead of allowing. Add tests for "Post" in a nav, "Send" in a chat box, an icon-only delete button and a non-English pay button.
- [ ] **Model-declared intent**: optional `irreversible: true` on `act`; the harness takes the higher of the model's and the classifier's verdict.
- [ ] **Injection benchmark that means something** (`core/injection.ts`): the 5/5 result uses five planted samples. Test against a larger public injection set, report the sample size next to the number, and treat the regex as a hint, not the defense. Optional small local classifier behind a flag (latency and size are the cost).
- [ ] **Site detector coverage** (`core/detector.ts`): URL and text patterns miss unlisted banks and regional sites. Add form-based signals (password plus account/routing/card fields) and a user-editable list.
- [ ] **Accessibility-tree cross-check**: compare our accessible names with `Accessibility.getFullAXTree` in tests to catch naming drift. Not a replacement: the AX tree has no stable refs and misses click-handler divs.
- [ ] **Keep structural defenses primary**: hidden-text drop, secret masking, approvals and per-site AI modes are the real protection; document that regex is defense in depth.

**Prove it**
- A success-rate benchmark: run real LLM agents on a task suite (WebVoyager or Mind2Web subsets) with each framework and report success, tokens, time and cost, not just payload size.

**Studios from the original plan**
- PDF Studio, Statement Analyzer (local-only), and Demo Studio narration (text-to-speech from steps).

## Suggested order

1. npm publish + CLI + Skill + native tool schemas (days; biggest reach per effort)
2. Recipes/replay and schema extract (largest further token cut)
3. Success-rate benchmark with real models
4. Python package, HTTP/Docker, framework adapters
5. Chrome extension mode
