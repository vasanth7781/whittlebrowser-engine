# Built-in chat

Open the Agent panel (⌘⇧A) and use the **Chat** tab, or press ⌘K → "Ask about this page…". The start page's example tasks open the chat with the prompt filled in.

## No API keys

The chat drives the AI CLI you already use:

| Provider | What runs | Billing |
|---|---|---|
| **Claude Code** | `claude -p … --output-format stream-json` | your Claude subscription or Claude Code login |
| **Codex** | `codex exec --json …` | your ChatGPT/Codex subscription |

The browser finds the CLIs through your login shell (`command -v claude`, `command -v codex`). Pick one in the dropdown under the message box; **New chat** starts a fresh conversation (otherwise each turn resumes the same session).

## What the model can do

Each turn attaches the whittlebrowser MCP server in `--shell` mode, and **only** its tools are allowed:

- Claude Code: `--strict-mcp-config --allowedTools mcp__whittlebrowser`. Other tools (shell, file edits) would need permission, which non-interactive mode denies.
- Codex: read-only sandbox, `mcp_servers.whittlebrowser.default_tools_approval_mode="approve"` for the browser tools only.

Everything else still applies: sites with the AI dot Off are invisible, sensitive pages auto-pause, and risky actions wait for your click in the panel.

## Savings meter

The strip at the top of the panel shows lifetime **tokens saved** (vs sending full, unfolded page views) and **tokens sent**. The start page shows the same counters plus pages read, injections flagged, secrets masked and RAM freed by Tab Sleeper.
