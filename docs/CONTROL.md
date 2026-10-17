# Host control protocol

The engine does not decide on its own what an agent may see or do. It asks a **policy**. In the
standalone mode a `StaticPolicy` answers from flags. When a browser (or any host app) runs the agent,
the engine talks to that host over a small local HTTP protocol, so the person using the host stays in
control: per-site AI modes, approvals, human handoff and a log of what was sent all come from this.

You can implement this protocol in your own app. The reference implementation is the desktop
browser's control server (in the browser repository) and `ShellPolicy` in `packages/engine/src/driver/policy.ts` (client).

## Discovery

The host writes `shell.json` (mode `0600`) into `WB_HOME` (default `~/.whittlebrowser`):

```json
{ "cdpPort": 9222, "controlPort": 51234, "token": "<random hex>", "pid": 4242 }
```

The engine connects with `whittlebrowser-mcp --shell`: it reads this file, attaches to the host's
Chromium over CDP (`http://127.0.0.1:<cdpPort>`), and uses the control server for every decision below.

## Transport and security

- Bind to `127.0.0.1` only.
- Every request carries `Authorization: Bearer <token>`; compare in constant time.
- Reject any request that has an `Origin` header (web pages must never be able to call it).
- Keep request bodies small (the reference server cuts off at 2 MB).
- If the host is unreachable, the engine fails closed: site mode `off`, approvals `no`.

## Endpoints

| Method and path | Body / query | Response | Meaning |
|---|---|---|---|
| `GET /policy?origin=` | origin | `{ "mode": "off" \| "ask" \| "allowed" }` | AI mode for a site |
| `GET /sensitive-overrides` | none | `{ "hosts": string[] }` | Hosts where the user overrode the auto-pause on sensitive pages |
| `GET /excluded-targets` | none | `{ "ids": string[] }` | CDP target ids the agent must never see (private tabs) |
| `POST /approve` | `{ kind: "site" \| "risk" \| "navigate", origin, summary }` | `{ "answer": "yes" \| "no" \| "confirm" }` | Blocks until the user answers (the engine waits up to 5 minutes) |
| `POST /handoff` | `{ reason, origin }` | `{ "done": boolean }` | Blocks until the user finishes a login, CAPTCHA, OTP or 2FA step and says Done |
| `POST /log` | `{ type, origin, text, tokens, at, meta? }` | `{}` | The exact, already scrubbed text that was sent to the model (powers "What AI sees") |
| `POST /tabs/open` | `{ url, background?, agent? }` | `{ "ok": boolean }` | Open a tab in a host that cannot create CDP targets |

`text` in `/log` has already been through the privacy filter: secrets, card numbers and tokens are
replaced by placeholders before they leave the engine.

## The same shape in code

`Policy` (in `packages/engine/src/driver/policy.ts`) is the interface behind these endpoints:
`siteMode`, `approve`, `allowedSensitiveHosts`, plus the optional `waitForUser`, `log`, `openTab` and
`excludedTargets`. A host that embeds the engine as a library can implement `Policy` directly and skip
HTTP entirely.
