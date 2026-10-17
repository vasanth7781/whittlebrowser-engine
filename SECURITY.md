# Security policy

WhittleBrowser sits between web pages and language models, so security reports matter to us.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately using GitHub's
"Report a vulnerability" (private security advisory) on this repository. Include:

- what you found and where (file, function or page behavior),
- steps or a minimal page that reproduces it,
- what an attacker gains (for example: a secret reaching the model, a hidden instruction reaching the
  model, an approval being skipped, or a local control-server request being accepted).

We aim to acknowledge a report within 3 working days and to tell you our plan within 14 days.

## In scope

- Secrets, card numbers, tokens or vault values reaching model-visible output (`packages/engine/src/core/privacy.ts`).
- Hidden or deceptive page text reaching the model unmarked (`packages/engine/src/core/injection.ts`, in-page agent).
- Bypassing per-site AI modes, auto-pause, or approvals for irreversible actions (`risk.ts`, `policy.ts`).
- The control protocol between the engine and a host app (`docs/CONTROL.md`, `HostPolicy`): authentication, origin checks, token handling.
- Reading private tabs from an agent, or reading files outside the allowed upload sandbox.

## Out of scope

- Findings that need an attacker who already controls your machine or your browser profile.
- Prompt-injection text that was correctly flagged (⚠) or dropped, but still "influenced" a model that
  chose to ignore the warning.
- Denial of service by loading very large pages (the serializer has token budgets; report if a budget can be bypassed).

## Supported versions

This project is pre-1.0. Fixes land on the main branch and in the latest published release only.
