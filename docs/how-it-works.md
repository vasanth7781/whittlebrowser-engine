# How it works

```
page ──► in-page agent (isolated world) ──► pruned tree ──► serializer ──► token budget ──► privacy filter ──► LLM
                                                                                                   ▲
LLM ──► act(steps) ──► gates (site mode, auto-pause, risk) ──► hit-test ──► real input ──► settle ──► diff ┘
```

## 1. The in-page agent

A single script runs inside each page in a **CDP isolated world**. Page JavaScript shares the DOM but not our globals, so it cannot patch `getBoundingClientRect`, read our refs, or fake what we see.

In one pass it computes for every element: ARIA role, accessible name, value, states, visibility and a **ref**. Things it handles that accessibility-tree tools miss:

- **div-onClick apps**: a `clickable` role from cursor, tabindex and onclick heuristics.
- **Icon-only buttons**: names borrowed from title, alt, icon class words or the link target (`upvote`, `close`, `cart`).
- **Custom checkboxes**: visually hidden inputs are surfaced through their visible label.
- **Hidden and deceptive text**: `display:none`, `aria-hidden`, sr-only, off-document, `opacity:0`, 1px fonts and white-on-white text are dropped. This is the main defence against indirect prompt injection.
- **Sensitive values**: password, card, OTP, ID and API-key fields are masked inside the page and never reach Node.

## 2. Stable refs

Each ref carries a fingerprint (role + name + occurrence). When React or Vue throws a node away and renders a new one, the new node gets the **same ref**. Before acting, a stale ref is remapped by fingerprint.

## 3. The serializer

- One space per depth, `[n]` refs, ARIA roles, landmarks shortened (`nav`, `header`, `footer`).
- Generic wrappers flattened, inline runs joined onto one line, label text deduplicated.
- Repeated siblings folded: `… +27 more items (observe ref 23)`.
- Text-less star ratings drawn with CSS classes (`star-rating Five`) are written out as `rating 5/5`.
- A token budget that degrades gracefully: shorter text → fold harder → summarize off-screen sections → cut.

## 4. Acting

`act` takes one step or many. For each step:

1. **Gates**: site AI mode, auto-pause, risk classifier (pay, delete, send, publish…).
2. **Hit-test**: if something covers the target, the step fails with `covered by dialog "Cookies"` instead of clicking blindly.
3. **Ghost cursor** (optional): an eased cursor and target ring animate in the page so people can watch.
4. **Real input** through CDP (mouse, keyboard), not synthetic DOM events.
5. **Settle**: navigation, network idle and DOM quiet, with timeouts.
6. **Report**: navigation, new tabs, dialogs, downloads, then a **diff** of what changed.

## 5. Privacy filter

Everything leaving the engine passes through one function. It turns cards (Luhn-checked), API keys, JWTs, SSNs and IBANs into reversible tokens like `‹card:1›` and replaces vault values with `‹secret:NAME›`. The model can type a token back; the real value is substituted locally.

## 6. The browser

The Electron shell adds the user-facing controls: the AI dot, auto-pause, approvals, X-ray, ghost cursor, live steps, split view for agent tabs, Tab Sleeper and a RAM meter. Agents talk to it over a token-protected local control channel and drive tabs over loopback CDP.
