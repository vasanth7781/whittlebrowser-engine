# Use with Claude Code

The engine has no model inside it. The thinking is done by whatever MCP client connects: with Claude Code, that is the Claude model you are logged into there.

```
you → Claude Code (Claude thinks) → whittlebrowser MCP server → Chromium window
```

## Register the server

Run once, from the repo root (build first: see [Getting started](getting-started.html)):

```bash
claude mcp add whittlebrowser -- node "$PWD/packages/engine/dist/mcp/cli.js"
```

`pnpm connect` runs exactly this command for you, and `pnpm connect --headless` adds flags. For Codex use `pnpm connect codex`.

- This opens its own Chromium window (sites allowed by default; auto-pause and risky-action checks still apply). Add `--headless` for no window.
- Add `--host` to attach to a host app that implements the [control protocol](control.html), so that app decides which sites the agent may see and approves risky actions.
- Add `--scope user` after `add` to make it available in every folder.
- `claude mcp list` / `claude mcp remove whittlebrowser` to inspect or remove.

## Tools

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

## Commands

Two small commands run instead of the server:

| Command | What it does |
|---|---|
| `whittlebrowser install-skill [--dir SKILLS_DIR]` | copies the bundled Claude skill to `~/.claude/skills/whittlebrowser` |
| `whittlebrowser print-config [server flags]` | prints the MCP config JSON with full paths, for apps that do not see your shell PATH (Claude Desktop) |

With `npx` they are `npx -y @whittlebrowser/engine install-skill` and, after `npm i -g @whittlebrowser/engine`, `whittlebrowser print-config`.

## Flags

`--headless`, `--ephemeral`, `--profile DIR`, `--channel chrome`, `--budget N`, `--allow-site HOST`, `--risk confirm|auto|deny`, `--robots off|warn|enforce`, `--default-off`, `--no-identify`, `--allow-file-urls`, `--humanize`, `--show-cursor`, `--no-cursor`, `--xray`, `--bot-key FILE --bot-agent URL`, `--host`.

## Secrets

Never paste passwords into a chat. Put them in a local vault and let the agent refer to them by name:

```bash
export WB_SECRET_GITHUB_PW='…'        # or ~/.whittlebrowser/secrets.json (chmod 600)
```

The agent types `secret:GITHUB_PW`; the value is filled in locally and is scrubbed from everything sent back.
