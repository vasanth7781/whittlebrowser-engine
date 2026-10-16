# X-ray, ghost cursor and live steps

Trust comes from being able to see what the agent sees and does.

## X-ray (⌘⇧X)

X-ray draws the agent's view on top of the real page:

- **Blue badges**: every control the model can act on, with its ref number.
- **Amber 🔒 masked**: sensitive fields whose values are hidden from the model.
- **Red dashed "hidden from AI"**: text that is on the page but withheld (white-on-white, tiny fonts, opacity 0, aria-hidden).
- **Red solid "⚠ looks like injection"**: visible text that reads like instructions to an AI.
- A legend with counts and how long the scan took.

It runs in the same isolated world as the agent, so when an agent is attached the badges match the refs the model uses. Turn it on from the AI dot menu, the command bar, or with `--xray` in standalone mode.

## Ghost cursor and human-like input

Before each click, hover, type or select, a small caption next to the pointer says what is about to happen (`click · Place order`). There is no box around the target: the pointer itself shows where it is going. The ghost cursor draws the **real** pointer: it follows the CDP mouse events the agent sends, so what you see is what the page receives.

With humanized input on (default in the browser), the real pointer moves like a hand:

- **Duration** from Fitts's law: `T = a + b·log2(D/W + 1)`, so longer moves to smaller targets take longer.
- **Speed profile** is minimum-jerk: it starts slowly, is fastest mid-way, and settles at the end.
- **Path shape varies** like a real hand: usually a gentle arc, often an S-curve that crosses the straight line, and now and then a wide detour that swings out and comes back. A fast tremor plus a slow drift fade out as it lands.
- **Corrections**: the first movement often stops a little short of the target or slightly past it, then a short second movement finishes the job after a brief reaction pause. Long moves sometimes slow mid-way, as if re-aiming.
- **Landing point** spreads around the centre of the target (inside its middle 60%), not the exact pixel.
- **Typing** uses a natural rhythm: variable inter-key delays, slower after spaces and punctuation, an occasional pause.

**Idle hand.** Between tool calls, while the model is thinking, the cursor doesn't freeze. It makes small settling moves and slowly drifts toward headings, text and links, as if reading. Right after the agent opens a site, it appears where the hand was and starts reading the page. The idle drift is **drawn only**: no mouse events reach the page, so no menus open on hover and nothing the agent sees changes. If you move your own mouse, the drift stops and leaves you alone. The next real move starts exactly where the drawn cursor is, so it never jumps.

This is for people watching and for demo videos. It is **not** a bot-detection evasion feature: the browser still identifies itself (User-Agent token, Web Bot Auth) and hands CAPTCHAs to you.

Flags: `--shell` turns on cursor + humanized input (`--fast` skips humanizing), `--show-cursor` and `--humanize` enable them standalone, `--no-cursor` turns the cursor off.

## Live steps

The Agent panel (⌘⇧A) shows a live feed of steps as they happen, separate from the activity log. Each log entry expands to show **exactly** what was sent to the model and its token count.
