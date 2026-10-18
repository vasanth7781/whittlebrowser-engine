# Research mode

Most agents read pages one at a time: open, read the whole page, go back, repeat. Research mode opens several pages **in parallel** and returns a compact digest of each, so the model can compare them in one step.

```
research {}                                      # top result links on the current page
research { urls: ["a.com/x", "b.com/y"], limit: 5, budget: 450, keep: true }
```

- **No urls**: the first link of each repeated result item on the current page (search results, archives, feeds), unwrapping search-engine redirects.
- **budget**: tokens per page (default 450). The digest keeps the title, each heading with the first lines under it, then fills in order.
- **keep**: leave the tabs open afterwards.

Every page still goes through the gates: sites with AI off are reported as `⏸`, payment pages auto-pause, hidden injections are dropped and visible ones flagged `⚠`.

## Example

> Use whittlebrowser. Search for "best espresso grinder 2026", run research on the top 5 results, and give me a comparison table of price, burr type and pros/cons.
