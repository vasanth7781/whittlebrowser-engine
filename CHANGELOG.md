# Changelog

All notable changes to `@whittlebrowser/engine`. Dates are release dates.

## 0.1.0 (2026-10-18)

First public release.

- MCP server (`whittlebrowser`) with nine tools: `observe`, `act`, `navigate`, `find`, `extract`, `research`, `tabs`, `screenshot`, `wait`.
- Pages as compact, ref-stable text with diffs after each action; repeated items folded; a token budget that degrades gracefully.
- Privacy filter (secrets and hidden prompt injections kept away from the model), risk gate for irreversible actions (including Enter in a form), only http(s) pages opened by default, auto-pause on sensitive pages.
- `find css:` to count and inspect elements, rating hints for star ratings drawn with CSS.
- `pnpm connect` for Claude Code, Codex, Claude Desktop and the Claude skill; a skill (`skills/whittlebrowser`) that teaches a model to use the tools.
- Benchmarks: page views against Playwright MCP, browser-use and Stagehand, and real-agent runs with Claude Haiku and Sonnet.
- Falls back to an installed Google Chrome when Chromium was not downloaded.
