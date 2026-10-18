# Introduction

**WhittleBrowser** is an open-source engine that lets an AI agent use a web browser while sending the model far fewer tokens, and keeping secrets and hidden prompt injections away from it. It runs as an **MCP server**, so Claude Code, Cursor, Codex, VS Code and any other MCP client can use it, and it is also a TypeScript library.

## What it does

- **Cheap to read.** A page becomes compact, ref-stable text within a token budget. After an action the model gets only what changed. On our 11-page benchmark one page view costs about 96% fewer tokens than Playwright MCP. In real agent runs on whole tasks the saving is smaller and depends on the task: large or re-rendering pages save the most, small pages save little. See the [benchmark](benchmark.html) for every number and how it was measured.
- **Safe by default.** Secrets are masked and hidden prompt injections are dropped before text reaches the model. Sensitive pages (banks, payment forms, credential fields) pause the agent. Irreversible actions need approval.
- **Watchable.** X-ray overlays what the agent sees, and an optional ghost cursor shows what it is about to do.
- **Fast at research.** Read several pages in parallel and get one compact digest.
- **Honest.** It identifies itself and hands CAPTCHAs to a person instead of trying to defeat bot protection.

## Where to next

- [Getting started](getting-started.html): install and run it. The package is [`@whittlebrowser/engine` on npm](https://www.npmjs.com/package/@whittlebrowser/engine).
- [Use with Claude Code](claude-code.html) or [other AI tools](use-with-ai-tools.html): connect an agent in one command.
- [How it works](how-it-works.html): the in-page agent, refs, serializer, diffs.
- [Protocol](protocol.html): the exact view format and every tool.
- [Safety model](safety.html): each threat and its defence.
- [Benchmark](benchmark.html) and [comparison](comparison.html).
