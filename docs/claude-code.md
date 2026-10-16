# Use with Claude Code

The browser has no model inside it. The thinking is done by whatever MCP client connects: with Claude Code, that is the Claude model you are logged into there.

```
you → Claude Code (Claude thinks) → whittlebrowser MCP server → WhittleBrowser window
```

## Register the server

Run once, from the repo root:

```bash
claude mcp add whittlebrowser -- node "$PWD/packages/engine/dist/mcp/cli.js" --shell
```

- `--shell` attaches to the running WhittleBrowser window, so your AI dot, auto-pause and approvals apply, and the ghost cursor is on.
- Leave out `--shell` to let the server open its own Chromium window instead (sites allowed by default; auto-pause and risky-action checks still apply).
- Add `--scope user` after `add` to make it available in every folder.
- `claude mcp list` / `claude mcp remove whittlebrowser` to inspect or remove.

## Try it

1. Open the desktop browser (separate repository, not released yet) and set the AI dot to **Allowed**, or skip this step and run the server without `--shell` so it opens its own Chromium window.
2. Start `claude` in the repo folder; `/mcp` should list `whittlebrowser`.
3. Ask, for example:

> Use whittlebrowser to read the page in my browser and summarize it.

> Search Substack for "AI agents", open the first 3 posts one by one, and give me title, author and a 3-line summary for each.

> Use whittlebrowser research on these results and give me a comparison table.

> Click Subscribe on this blog. *(an approval card appears in the Agent panel)*

Open the Agent panel (⌘⇧A) to watch each step, the exact text Claude was sent, and the token count.

## Tools

| Tool | What it does |
|---|---|
| `observe` | Compact view of the page (or one subtree) within a token budget |
| `act` | One or more steps (click, type, select, check, hover, press, scroll, upload); returns outcome + diff |
| `navigate` | URL, search words, back, forward, reload |
| `find` | Search the whole page, including off-screen, ranked |
| `extract` | `table`, `list` (repeated cards as rows), `text` (main content as markdown), paged |
| `research` | Open several pages in parallel and return a compact digest of each |
| `tabs` | list, open, switch, close |
| `screenshot` | JPEG with sensitive fields blurred (last resort) |
| `wait` | For text, for a delay, or hand control to you (CAPTCHA, 2FA) |

## Flags

`--headless`, `--ephemeral`, `--profile DIR`, `--channel chrome`, `--budget N`, `--allow-site HOST`, `--risk confirm|auto|deny`, `--robots off|warn|enforce`, `--default-off`, `--no-identify`, `--humanize`, `--show-cursor`, `--no-cursor`, `--xray`, `--bot-key FILE --bot-agent URL`.

## Secrets

Never paste passwords into a chat. Put them in a local vault and let the agent refer to them by name:

```bash
export WB_SECRET_GITHUB_PW='…'        # or ~/.whittlebrowser/secrets.json (chmod 600)
```

The agent types `secret:GITHUB_PW`; the value is filled in locally and is scrubbed from everything sent back.
