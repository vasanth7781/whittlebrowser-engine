# Pages without semantic tags

Real apps rarely use `<button>`, `<nav>` or `<dialog>`. A card is a `<div>` with a click handler, the header is `<div class="topbar">`, a modal is a fixed overlay. Accessibility-tree tools see these as plain text. WhittleBrowser recovers the structure in three ways.

## 1. Find real click handlers

Before each snapshot (only when the DOM changed), a small probe runs in the page's **main world**, where framework state lives:

- `getEventListeners()` (DevTools command-line API) catches handlers added with `addEventListener`, which covers vanilla JS, Vue, Angular and Svelte.
- `__reactProps$…` catches React's `onClick` / `onMouseDown` / `onPointerDown`. React delegates its listeners to the root, so listener inspection alone would miss them.

Matching elements become `clickable`. Delegation roots (big containers with many controls) are ignored. The page could fake these hints, but the worst case is a missing or extra `clickable`; nothing is executed.

Other signals still apply: `cursor: pointer` (where it starts), `tabindex`, `onclick` attributes, contenteditable.

## 2. Infer landmarks and widgets

For `div`/`section`/`span`/`li` and custom elements without a role:

| Signal | Becomes |
|---|---|
| `position: fixed`, z-index ≥ 10, large, with controls; or class `modal/dialog/drawer/lightbox`; or `aria-modal` | `dialog` (named from its title/heading) |
| class `dropdown/menu/popover`, absolutely positioned, ≥ 2 items | `menu` |
| class `topbar/header/masthead/appbar` near the top, full width | `header` (banner) |
| class `nav/navbar/breadcrumb` with controls | `nav` |
| class `sidebar/sidenav` | `aside` / `nav` |
| class `footer` in the lower half | `footer` |
| class `tabs/tablist` | `tablist` |
| class `toast/snackbar/notification` | `status` |
| class `search` containing an input | `search` |
| no `<main>`: the deepest block holding most non-link text | `main` |

Class and id names are tokenized (`siteHeader` → `site`, `header`; `top-bar` → `top`, `bar`).

## 3. Name icon-only controls

When a control has no accessible name: a descendant's `title`/`aria-label`/`alt`, then icon class words (`close`, `menu`, `cart`, `upvote`…), then the link's last path segment.

Controls with `aria-haspopup` show `popup`, so the model knows a click opens something. After the click, the diff shows what opened:

```
✓ click [13] clickable "Order #1002 $18.50 · processing"
Δ +2 −0 ~0
+ [19] dialog "Order #1002"
+  Order #1002 Ships in 2 days. [20] clickable "Track package" [21] clickable "Close"
```
