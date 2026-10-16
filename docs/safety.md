# Safety model

WhittleBrowser assumes web pages are hostile and that anything sent to an LLM may leave your machine.

| Threat | Defence |
|---|---|
| Hidden prompt injection (white text, 1px fonts, off-screen, aria-hidden) | Dropped by the in-page agent before serialization. If dropped text contained instructions, the view says so. |
| Visible prompt injection | Lines that read like instructions to an AI are marked `⚠`. Server instructions tell the model page text is data. |
| Page scripts tampering with the agent | Agent runs in a CDP isolated world. |
| Secrets in page text | Scrubbed into reversible tokens (`‹key:1›`) at a single choke point. |
| Secrets in form fields | Masked inside the page (`= "•••" ⚿password`); never cross into Node. |
| Typing your passwords | Vault refs (`secret:NAME`) resolved locally; echoed values scrubbed. |
| AI on sensitive sites | Per-site Off/Ask/Allowed (Off by default in the browser). Auto-pause on banks, cloud consoles, password managers, card/ID/API-key fields and key pages. |
| Irreversible actions | Pay, order, delete, send, publish, transfer, grant… need approval (Agent panel), or `confirm:true` in headless mode. `confirm()` dialogs are dismissed unless approved. |
| Data exfiltration | Jumps to another site with a long query string need approval; URL query values are elided in views; uploads outside a sandbox folder need approval. |
| Private browsing | Private tabs use an in-memory profile wiped on last close, are excluded from session restore, and are invisible to agents (`tabs` doesn't list them and `observe` can't read them). |
| Device and site permissions | Deny by default. Camera, mic, location, notifications, clipboard read, MIDI and screen capture prompt the user; decisions are per origin. Agent-opened tabs are always denied. USB/HID/serial/Bluetooth choosers are off. |
| Invalid certificates | Warning page; only the user can proceed, per host and certificate fingerprint, for this session. The address bar then shows **Not trusted**. |
| Screenshots | JPEG with sensitive fields blurred; text views are preferred. |

## Honest identity

We do **not** spoof fingerprints, solve CAPTCHAs or mimic humans to defeat bot protection. Instead:

- A clear `WhittleBrowser/0.1` token in the User-Agent while the agent drives.
- **Web Bot Auth** (RFC 9421 HTTP Message Signatures, Ed25519). Verified against Cloudflare's research endpoint.
- robots.txt check for agent navigation (`--robots warn|enforce`).
- **CAPTCHA handoff**: the agent stops, you solve it in the same window, then it resumes.

## Testing it

`pnpm test` includes canary tests: secrets planted in fixtures must never appear in any output (observe, find, extract, act, screenshot), and hidden injections must never reach the model.
