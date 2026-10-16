# WhittleBrowser

A lightweight, Chromium-based browser and agent protocol. AI is **off by default per site**, pages are
shown to models as **compact, ref-stable, diffed text**, and secrets and hidden prompt injections
**never reach the LLM**.

- `packages/engine`: the protocol (in-page agent in a CDP isolated world, serializer, differ, privacy
  filter, detectors), a Playwright/CDP driver and an MCP server (`whittlebrowser-mcp`).
- The WhittleBrowser desktop browser (per-site AI, X-ray, ghost cursor, built-in chat, Demo Studio) is developed in a separate repository and is not released yet. The engine here works on its own with any MCP client.
- `website`: the animated landing page and docs site (`pnpm --filter @whittlebrowser/website dev`).

See [docs/GAPS.md](docs/GAPS.md) for the gap analysis, [docs/PROTOCOL.md](docs/PROTOCOL.md) for the format,
and [docs/BENCHMARK.md](docs/BENCHMARK.md) for the numbers.

## Benchmark: WhittleBrowser vs Playwright MCP, browser-use and Stagehand

Same 11 pages (5 test pages + 6 live sites), same Chromium, each tool's own code, o200k tokens, no LLM calls. Full methodology and charts are in [docs/BENCHMARK.md](docs/BENCHMARK.md).

| | Playwright MCP | browser-use | Stagehand | **WhittleBrowser** |
|---|---:|---:|---:|---:|
| page text, 11 pages | 301,165 | 30,682 (+ screenshots) | 260,251 | **13,534** |
| all-in incl. prompts/tool defs/screenshots | 342,382 | 167,907 | 267,632 | **24,809** |
| WhittleBrowser uses | 93% fewer | 85% fewer | 91% fewer | |
| planted secrets reaching the model | 7 / 7 | 6 / 7 | 6 / 7 | **0 / 7** |
| hidden prompt injections reaching the model | 5 / 5 | 3 / 5 | 4 / 5 | **0 / 5** |

## Quick start

```bash
pnpm install
pnpm --filter @whittlebrowser/engine build
npx playwright-core install chromium   # once

pnpm test        # engine unit + browser + MCP tests (headless)
pnpm bench       # benchmark (add -- --live --pw-mcp; run packages/engine/bench/compare/setup.sh once for browser-use + Stagehand)
```

### Use it from Claude Code (or any MCP client)

```bash
claude mcp add whittlebrowser -- node "$PWD/packages/engine/dist/mcp/cli.js"           # own Chromium window
claude mcp add whittlebrowser -- node "$PWD/packages/engine/dist/mcp/cli.js" --shell   # drive the desktop browser, when it is running
```

Flags: `--headless`, `--ephemeral`, `--profile DIR`, `--channel chrome`, `--budget N`,
`--allow-site HOST` (override auto-pause), `--risk confirm|auto|deny`, `--robots off|warn|enforce`,
`--default-off`, `--no-identify`, `--humanize`, `--bot-key FILE --bot-agent URL` (Web Bot Auth).

Secrets for `type secret:NAME`: env `WB_SECRET_NAME=…` or `~/.whittlebrowser/secrets.json` (chmod 600).

## Cloud (commercial)

A hosted version runs the same engine in isolated machines behind an API, with a live view so a person can finish
logins, one-time codes and challenges. It is prepaid credits only. Its code is proprietary and lives in a separate
repository; everything in this repository is MIT.

## How it stays cheap

1. The in-page agent prunes the DOM in one pass: roles, accessible names, states, visibility, refs.
2. The serializer flattens wrappers, merges inline runs, deduplicates labels, folds repeated siblings,
   and fits a token budget.
3. Actions return outcome + diff, not the page. Steps can be batched.
4. `find` and `extract` answer targeted questions without reading the whole page.

## How it stays safe

- Isolated-world agent; hidden and deceptive text dropped; ⚠ on instruction-like text.
- Sensitive values masked in the page; one scrubbing choke point; reversible tokens; local vault.
- Per-site AI modes (default Off in the shell), auto-pause on banking, consoles, and card/ID/key pages.
- Approval for irreversible actions, data-carrying cross-site jumps, and uploads outside a sandbox dir.
- Honest identity: UA token, Web Bot Auth signatures, robots.txt, CAPTCHA handoff to the human.
  No fingerprint spoofing and no CAPTCHA solving.

## Layout

```
packages/engine/src/page/agent.ts     in-page agent (isolated world)
packages/engine/src/core/             serializer, diff, privacy, detector, injection, risk, robots, web bot auth
packages/engine/src/driver/           session (observe/act/find/extract/...), policy, launch
packages/engine/src/mcp/              MCP server + CLI
packages/engine/test, bench           tests, fixtures, benchmark
website/                              landing page and docs site (renders docs/*.md)
```

## License

MIT, see [LICENSE](LICENSE). Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report
security issues privately, see [SECURITY.md](SECURITY.md). The host control protocol that lets an app embed
the engine is in [docs/CONTROL.md](docs/CONTROL.md).
