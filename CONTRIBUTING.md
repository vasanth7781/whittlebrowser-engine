# Contributing

Thanks for helping. This repository is MIT licensed (see [LICENSE](LICENSE)).

## Set up

```bash
pnpm install
pnpm --filter @whittlebrowser/engine build
npx playwright-core install chromium   # once
pnpm test                              # engine unit, browser and MCP tests (headless)
pnpm typecheck
```

## What a good change looks like

- Small and focused, with a test. The engine tests live in `packages/engine/test`; fixtures are in
  `packages/engine/test/fixtures`.
- It keeps the token budget honest: if you change the serializer, differ or in-page agent, run
  `pnpm bench` and include the before/after numbers in your pull request.
- It keeps the safety properties: nothing sensitive may reach model-visible output, and hidden or
  instruction-like page text must stay dropped or flagged. Add a fixture when you fix a leak.
- It matches the surrounding code style. No new dependencies without a reason in the pull request.

## Out of scope for this repository

Features whose purpose is to defeat a website's bot protection (fingerprint spoofing, CAPTCHA solving,
stealth patches) will not be accepted. See [docs/safety.md](docs/safety.md).

## Test pages and screenshots

The pages in `packages/engine/test/fixtures` double as the sites shown in the website screenshots, so they share one look (`theme.css`). After editing it, run
`node packages/engine/test/fixtures/apply-theme.mjs` to re-inject it (it only adds a `<style data-theme>` block at the top of each page, and each page's own
styles still win).

## Sign your commits (DCO)

Add a `Signed-off-by` line to each commit with `git commit -s`. It certifies that you wrote the change
or have the right to submit it under the MIT license (the Developer Certificate of Origin,
https://developercertificate.org).

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
