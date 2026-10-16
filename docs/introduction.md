# Introduction

**WhittleBrowser** is a lightweight Chromium browser and agent protocol built for AI agents and for the people who supervise them.

- **Cheap to read.** Pages become compact, ref-stable text within a token budget. After an action the model gets only what changed. 96% fewer tokens per page view and 85% fewer per task than Playwright MCP in our benchmark.
- **Safe by default.** AI is off per site until you allow it. Banking, payment and credential pages auto-pause. Secrets and hidden prompt injections never reach the model. Irreversible actions wait for your click.
- **Watchable.** X-ray shows what the agent sees, a ghost cursor shows what it is about to do, and the Agent panel streams every step with the exact text sent to the model.
- **Fast at research.** Read many pages in parallel and get one compact digest.
- **Honest.** It identifies itself and hands CAPTCHAs to you instead of trying to defeat bot protection.

## Where to next

- [Getting started](getting-started.html): install, open the browser, shortcuts.
- [Use with Claude Code](claude-code.html): connect an agent in one command.
- [How it works](how-it-works.html): the in-page agent, refs, serializer, diffs.
- [Safety model](safety.html): every threat and its defence.
- [Benchmark](benchmark.html) and [Gaps & comparison](comparison.html).
