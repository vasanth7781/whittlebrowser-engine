# Getting started

WhittleBrowser is an MCP server (and a TypeScript library) that lets an AI agent drive a Chromium browser through compact text views.

## Requirements

- macOS (Linux and Windows should work but are untested)
- Node.js 22 or newer
- pnpm 10 (`npm i -g pnpm`)

## Install from source

The npm package is not published. Run it from a clone:

```bash
git clone https://github.com/vasanth7781/whittlebrowser-engine.git
cd whittlebrowser-engine
pnpm install
pnpm --filter @whittlebrowser/engine build
npx playwright-core install chromium    # downloads the browser it drives (once; skip it if Google Chrome is installed)
```

## Connect an agent

```bash
pnpm connect          # Claude Code
pnpm connect codex    # Codex
pnpm connect desktop  # Claude Desktop (then quit and reopen it)
pnpm connect skill    # optional: a skill that teaches Claude to use the tools cheaply and safely
```

Each runs `claude mcp add` or `codex mcp add` with the right path, and prints the config JSON for Cursor, VS Code and other clients. This opens its own Chromium window. Add `--headless` for no window or `--ephemeral` for a throwaway profile. Setup for Cursor, Codex, VS Code and others is in [Use it with Claude, Cursor, Codex and other AI tools](use-with-ai-tools.html); the full flag list is in [Use with Claude Code](claude-code.html).

## Try it

Ask your agent, for example:

> Use whittlebrowser to open news.ycombinator.com and list the top 5 stories with their links.

Watch the token count of each call in your agent's tool output. To see exactly what the model is sent for a page, run the server with `--xray` and compare the overlay with the text view.

## Run the tests and benchmark

```bash
pnpm test                       # unit + browser + MCP tests (headless)
pnpm bench                      # token and safety benchmark vs Playwright MCP, browser-use, Stagehand
pnpm bench -- --live --pw-mcp   # include live sites and Playwright MCP's tool definitions
pnpm bench:agent --smoke        # one real-agent run per tool through Claude Code (needs the claude CLI)
```

## Use it as a library

```ts
import { Session, launch, StaticPolicy } from '@whittlebrowser/engine';
```

See [Protocol](protocol.html) for the view format and tool arguments.
