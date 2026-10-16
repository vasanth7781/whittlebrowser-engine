# @whittlebrowser/engine

A token-lean, ref-stable, privacy-first browser protocol for AI agents: an in-page agent (runs in a CDP
isolated world), a serializer and differ that send models compact text and only what changed, a privacy
filter that keeps secrets and hidden prompt injections away from the model, a Playwright/CDP driver, and an
MCP server (`whittlebrowser-mcp`).

Run it from a clone of this repository (the npm package is not published yet):

```bash
pnpm install && pnpm --filter @whittlebrowser/engine build
node packages/engine/dist/mcp/cli.js              # launch Chromium with a persistent profile
node packages/engine/dist/mcp/cli.js --headless   # headless
```

Use it from Claude Code (or any MCP client), with the absolute path to that file:

```bash
claude mcp add whittlebrowser -- node /absolute/path/to/packages/engine/dist/mcp/cli.js
```

> Do not run `npx whittlebrowser-mcp`: that name on npm is a different project. Setup for Claude, Cursor, Codex, VS Code and others: `docs/use-with-ai-tools.md`.

Use it as a library:

```ts
import { Session, launch, StaticPolicy } from '@whittlebrowser/engine';
import { render, Privacy } from '@whittlebrowser/engine/core';
```

Exports: `.` (session, driver, policy), `./core` (serializer, differ, privacy, detectors), `./page` (the
in-page agent source) and `./humanpath`.

Docs, benchmark and protocol: see the repository root. Security reports: see `SECURITY.md`.

MIT licensed.
