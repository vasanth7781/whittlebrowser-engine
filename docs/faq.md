# FAQ

**Which LLM does it use?**
None is bundled. Any MCP client brings its own model; with Claude Code that is the Claude model you are logged into.

**Why not just use screenshots?**
Screenshots are expensive (vision agents used ~45× more input tokens than API agents in one benchmark) and give the model nothing to act on directly. Text views with refs are cheaper and more precise. `screenshot` exists for the cases where layout matters.

**Does it get past Cloudflare?**
It doesn't try to sneak past. It identifies itself (User-Agent token, Web Bot Auth signatures) and hands CAPTCHAs to a person. A logged-in session you provide already carries trust.

**Is my data sent anywhere?**
The engine sends nothing by itself. What your agent sends to its model is exactly the text the tools return, after masking and scrubbing.

**Why does `--default-off` exist?**
Default-deny is the safest start for a browser with real logins in it. With it (or a host app that owns policy), every site is Off until you allow it.

**Does it read cross-origin iframes?**
Not yet. They are listed as `iframe "host" cross-origin` but their contents are not expanded. Closed shadow roots, canvas-only apps and rows of a virtualized list that are not rendered are also not visible to it.

**Does it record and replay workflows?**
The session trace records every call with its tokens and timing, but replaying a workflow without a model is not available.

**Does the human-like cursor help get past bot detection?**
No, and it is not meant to. It exists so people can follow the agent and so demo videos look natural. The engine still identifies itself and hands CAPTCHAs to a person.
