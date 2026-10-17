# Agent protocol

Everything the model sees is plain text designed to be cheap to read and unambiguous to act on.

## Observation

```
# Shipping – Demo Shop · shop.example/checkout · ↓1.5
header
 nav "Primary"
  [3] link "Home"
main
 h1 Shipping
 [8] form "Shipping"
  [9] textbox "Email" required
  [11] combobox "Country" = "United States" (United States, Canada, Mexico, India +3)
  [12] checkbox "This is a gift"
  [13] radio "Standard" checked [14] radio "Express"
  By continuing you agree to our [15] link "Terms" and [16] link "Privacy Policy".
  [17] button "Continue to review"
 - [24] link "Widget 1" · $1.50 4.0 stars · [25] button "Add to cart"
 … +20 more items (observe ref 23)
```

- Header: title · compact URL (long query values elided) · screens above `↑` and below `↓`.
- One space per depth. Landmarks use short aliases (`nav`, `header`, `footer`, `aside`).
- `[n]` is a ref. Refs are unique for the whole session and stable across re-renders.
- Controls: `[n] role "name" = "value" (options) states ⚿kind`. `⚿` marks a sensitive field whose value is masked.
- States: `checked mixed disabled expanded collapsed selected current pressed required invalid readonly`.
- Inline runs stay on one line. List items with several parts use `- a · b`. Table rows use `a | b`.
- Folding: `… +N more items (observe ref R)`. Long prose: `… +N more text blocks (extract text)`.
- Notes start with `⚠` (suspected injection, removed hidden instructions, bot challenge), `⚿` (sensitive page), or `⏸` (AI off/paused: nothing from the page was sent).

## Act result

```
✓ type [9] textbox "Email" "jane@example.com"
✓ select [11] combobox "Country" = Canada
✓ click [17] button "Continue to review"
→ shop.example/checkout → shop.example/review · "Review – Demo Shop"
! confirm "Delete the order?" dismissed (repeat the action with confirm:true to accept)
⧉ new tab 2 opened (now active)
↧ downloaded statement.pdf → ~/Downloads/whittlebrowser/statement.pdf
Δ +1 −0 ~2
@ [8] form "Shipping"
~ [9] textbox "Email" = "jane@example.com" required
+  alert: Please enter a valid postcode
```

When the page navigates, or a diff would cost more than 75% of a full view, the full observation is sent instead.

## Tools (MCP)

| tool | args | notes |
|---|---|---|
| observe | mode? actions\|full\|read, ref?, budget? | `ref` expands a subtree with folding relaxed |
| act | do + ref/text/values/key/dy/files, or steps[], confirm? | `type` accepts `secret:NAME` and `‹kind:n›` tokens |
| navigate | url (or search words, back, forward, reload), confirm? | |
| find | q, limit? | `role:button pay` filters by role; searches off-screen too. `css:.star-rating.Five` counts the visible matches and lists their class and common attributes (read-only; no script runs) |
| extract | kind table\|list\|text, ref?, offset?, links? | paged; `list` turns repeated cards into rows |
| research | urls?, limit?, budget?, keep? | opens pages in parallel and returns a compact digest of each; no `urls` uses the top result links on the current page |
| tabs | op list\|open\|switch\|close, url?, index? | |
| screenshot | ref? | JPEG, sensitive fields blurred; last resort |
| wait | text? gone? ms? user? | `user` hands control to the human (CAPTCHA, 2FA) |

## Privacy tokens

`‹card:1›`, `‹key:2›`, `‹jwt:1›`, `‹ssn:1›`, `‹iban:1›`, `‹secret:NAME›` stand for values that never leave the
machine. The model can type them back and they are resolved locally.
