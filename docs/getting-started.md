# Getting started

WhittleBrowser has two parts:

- **The browser**: a slim Chromium browser with per-site AI controls, X-ray, a live agent panel and Tab Sleeper. It is developed in a separate repository and is not released yet.
- **The engine** (`packages/engine`): the agent protocol and an MCP server that lets Claude Code (or any MCP client) drive the browser.

## Requirements

- macOS (Linux and Windows should work but are untested)
- Node.js 22 or newer
- pnpm 10 (`npm i -g pnpm`)

## Status of the desktop browser

The engine (MCP server, CLI and library) is the supported way to use WhittleBrowser today. The desktop browser is developed in a
separate repository and has no downloadable app yet because it needs more testing.

## Install from source

```bash
git clone <this repo> whittlebrowser
cd whittlebrowser
pnpm install
pnpm --filter @whittlebrowser/engine build
npx playwright-core install chromium    # only needed for the standalone/headless mode
```

## Open the browser

> The desktop browser is not part of this repository and is not released yet. This section describes it as designed; the
> engine works without it (see the MCP setup below).

A window opens on the start page: search, live stats and example tasks. A short tour shows the essentials on first launch. Your tabs are restored the next time you open it.

| Shortcut | Action |
|---|---|
| ⌘L | Focus the address bar (URL, `localhost:3000`, or search words) |
| ⌘T / ⌘W | New tab / close tab |
| ⌘⇧N | New private tab (nothing saved, agents can't see it) |
| ⌘D | Bookmark this page (bookmarks are on the start page and in ⌘K) |
| ⌥⌘M | Mute or unmute the tab |
| ⌘1…⌘9 | Jump to a tab |
| ⌘[ / ⌘] / ⌘R | Back / forward / reload |
| ⌘E | Expand the tab rail |
| ⌘K | Command bar (tabs, AI modes, X-ray, split view, sleep tabs) |
| ⌘⇧A | Agent panel (live steps, approvals, "What AI sees") |
| ⌘⇧X | X-ray: show what the AI sees on the page |
| ⌘⇧S | Split view: your tab next to live agent tabs |
| ⌘⇧R | Record a demo (opens Demo Studio when you stop) |
| ⌘F / ⌘G | Find in page / next match |

## Everyday browser features

- **Private tabs (⌘⇧N).** They use an in-memory profile, so cookies, storage and history disappear when the last private tab closes. They are never restored on restart, and no AI agent can list, read or control them.
- **Permissions.** Camera, microphone, location, notifications, clipboard reading, MIDI and screen sharing are denied until you answer the prompt bar: **Block**, **Allow once** or **Always allow**. Click the lock in the address bar to see or change a site's permissions. Tabs opened by an agent never get device access.
- **Certificates.** An invalid certificate shows a warning page. Only you can continue past it (agents can't), the exception lasts for this session only, and the address bar then says **Not trusted**. The lock shows the certificate's subject, issuer and expiry.
- **Audio and video.** Media with sound doesn't autoplay until you interact with the page (toggle it in ⌘K). Mute a tab with ⌥⌘M or the speaker in the address bar.
- **Bookmarks.** ⌘D or the star. They appear on the start page and under ★ in ⌘K.

## The AI dot

Every site starts with AI **Off**. Click the dot next to the address bar:

- **Off** (grey): agents see nothing from this site.
- **Ask** (amber): you approve before an agent can read it.
- **Allowed** (green): agents can read and act; risky actions still need your OK.
- **Red lock**: auto-paused because the page looks sensitive (bank, payment form, API keys). Nothing is sent.

## Chat with the agent

Press ⌘⇧A and use the **Chat** tab. It runs on your local Claude Code or Codex subscription; see [Built-in chat](chat.html).

## Connect an external agent

See [Use it with Claude, Cursor, Codex and other AI tools](use-with-ai-tools.html) for every client, ready-made prompts, and a rules file, or [Use with Claude Code](claude-code.html). In short:

```bash
claude mcp add whittlebrowser -- node "$PWD/packages/engine/dist/mcp/cli.js" --shell
```

## Run the tests and benchmark

```bash
pnpm test                       # unit + browser + MCP tests (headless)
pnpm bench                      # token/safety benchmark vs Playwright MCP
pnpm bench -- --live --pw-mcp   # include live sites and Playwright MCP's tool definitions
```
