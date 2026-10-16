# Demo Studio

Turn any browsing session (yours or the agent's) into a polished product video.

## Record

Press **⌘⇧R** (or ⌘K → "Record a demo video"). A red **REC** pill shows the time; click it or press ⌘⇧R again to stop. Recording captures:

- the active tab as video frames (CDP screencast, written to a temp folder, not kept in RAM),
- every click and focus, whether you or the agent made them,
- the agent's step labels, which become captions.

## Edit

While recording, the agent's in-page caption and click ripple are switched off, so captions and ripples in the video come only from the options below and you can turn them off.

Stopping opens the **Studio** window:

| Control | Effect |
|---|---|
| Auto-zoom on actions | the camera eases into each click/focus and back out |
| Zoom level | 1.2× – 2.4× |
| Captions from steps | "type · Email", "click · Continue to review" |
| Click ripples | expanding ring at each click |
| Draw smooth cursor | for human recordings (agent runs already show the ghost cursor); uses the same human-like paths as the agent |
| Speed up idle time ×4 | gaps without actions play faster |
| Intro & outro cards | title + subtitle, "Made with WhittleBrowser" |
| Background | five gradients behind a framed browser window |

Space plays and pauses; the timeline shows actions (ticks) and sped-up stretches (shaded).

## Export

**Export video** renders at 1920×1080, 30 fps, and saves **MP4** (when `ffmpeg` is installed) or **WebM** to your Movies folder.

## Tips for great demos

- Let the agent drive with the ghost cursor on (default in the browser). Its human-like motion and typing look natural on video.
- Keep one tab focused while recording; recording follows the tab that was active when you started.
