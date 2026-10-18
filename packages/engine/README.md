# @whittlebrowser/engine

A token-lean, ref-stable, privacy-first browser protocol for AI agents: an in-page agent (runs in a CDP
isolated world), a serializer and differ that send models compact text and only what changed, a privacy
filter that keeps secrets and hidden prompt injections away from the model, a Playwright/CDP driver, and an
MCP server (`whittlebrowser`).

Run it from a clone of this repository (the npm package is not published yet):

```bash
git clone https://github.com/vasanth7781/whittlebrowser-engine.git && cd whittlebrowser-engine
npx playwright-core install chromium     # once
pnpm install && pnpm --filter @whittlebrowser/engine build
node packages/engine/dist/mcp/cli.js              # launch Chromium with a persistent profile
node packages/engine/dist/mcp/cli.js --headless   # headless
```

Use it from Claude Code (or any MCP client). From the repository root, `pnpm connect` adds it to Claude Code and prints the config
JSON for other clients. Or by hand, with the absolute path to that file:

```bash
claude mcp add whittlebrowser -- node /absolute/path/to/packages/engine/dist/mcp/cli.js
```

Setup for Claude, Cursor, Codex, VS Code and others: `docs/use-with-ai-tools.md`.

## Tools

Nine MCP tools with short schemas (the whole list is about 1,000 tokens):

| Tool | What it does |
|---|---|
| `observe` | Compact view of the page (or one subtree) within a token budget |
| `act` | One or more steps (click, type, select, check, hover, press, scroll, upload); returns outcome + diff |
| `navigate` | URL, search words, back, forward, reload |
| `find` | Search the whole page, including off-screen, ranked. `role:button pay` filters by role; `css:SELECTOR` counts visible matches and lists their class and attributes |
| `extract` | `table`, `list` (repeated cards as rows), `text` (main content as markdown), paged |
| `research` | Open several pages in parallel and return a compact digest of each |
| `tabs` | list, open, switch, close |
| `screenshot` | JPEG with sensitive fields blurred (last resort) |
| `wait` | For text, for a delay, or hand control to you (CAPTCHA, 2FA) |

Full argument reference: `docs/PROTOCOL.md` in the repository.

Use it as a library:

```ts
import { Session, launch, StaticPolicy } from '@whittlebrowser/engine';
import { render, Privacy } from '@whittlebrowser/engine/core';
```

Exports: `.` (session, driver, policy), `./core` (serializer, differ, privacy, detectors), `./page` (the
in-page agent source) and `./humanpath`.

Docs, benchmark and protocol: see the repository root. Security reports: see `SECURITY.md`.

MIT licensed.
