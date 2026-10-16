# FAQ

**Which LLM does it use?**
None is bundled. The built-in chat runs your local Claude Code or Codex CLI, so it uses your existing subscription. External agents (any MCP client) bring their own model.

**Why not just use screenshots?**
Screenshots are expensive (vision agents used ~45× more input tokens than API agents in one benchmark) and give the model nothing to act on directly. Text views with refs are cheaper and more precise. `screenshot` exists for the cases where layout matters.

**Does it get past Cloudflare?**
It doesn't try to sneak past. It identifies itself (UA token, Web Bot Auth signatures) and hands CAPTCHAs to you. Your own logged-in session already carries trust.

**Is my data sent anywhere?**
The browser sends nothing. What the agent sends to its LLM is exactly what you see in "What AI sees", after masking and scrubbing.

**Why is AI off by default?**
Default-deny is the only safe default for a browser with your logins in it. Turn it on per site with one click.

**How much memory does it use?**
Each tab is a Chromium renderer, like Chrome. Tab Sleeper freezes background tabs after 5 minutes and discards them after 30 or when the memory budget is exceeded; the ⋯ menu shows per-tab MB.

**Does it have private browsing, bookmarks and site permissions?**
Yes. ⌘⇧N opens a private tab (in-memory, wiped when the last one closes, hidden from agents). ⌘D bookmarks a page. Camera, mic, location and notifications are denied until you allow them, invalid certificates get a warning page, and sound doesn't autoplay. See [Getting started](getting-started.html#everyday-browser-features).

**Cross-origin iframes?**
Listed but not expanded yet. On the roadmap together with deterministic replay, PDF Studio and Statement Analyzer.

**Does the human-like cursor help get past bot detection?**
That's not its purpose and we don't market it that way: it exists so people can follow the agent and so demo videos look natural. The browser identifies itself and hands CAPTCHAs to you.
