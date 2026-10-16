/**
 * Human-like pointer and typing timing, for watchable agents and demo recordings.
 *
 * Motion model: Fitts's-law duration (T = a + b·log2(D/W + 1)), a minimum-jerk speed profile
 * (smooth start and stop), a curved cubic Bézier path, a small physiological tremor that fades as the
 * hand settles, an occasional overshoot with a short correction, and a landing point spread inside the
 * target instead of its exact centre. Paths vary in shape (arc, S-curve crossing the line, wide detour), the
 * primary move often under- or overshoots and is corrected, and an idle hand drifts while the agent thinks.
 *
 * This is for people watching the agent. It is not a bot-detection evasion technique: WhittleBrowser
 * still identifies itself (User-Agent token, Web Bot Auth) and hands CAPTCHAs to the user.
 */
export interface PathPoint { x: number; y: number; dt: number }

export interface Rect { x: number; y: number; width: number; height: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** A point inside the target, biased to the centre like real clicks. */
export function landingPoint(r: Rect, fallback: { x: number; y: number }): { x: number; y: number } {
  if (!r.width || !r.height) return fallback;
  const x = r.x + r.width / 2 + gauss() * r.width * 0.12;
  const y = r.y + r.height / 2 + gauss() * r.height * 0.12;
  return { x: Math.min(r.x + r.width - 2, Math.max(r.x + 2, x)), y: Math.min(r.y + r.height - 2, Math.max(r.y + 2, y)) };
}

/**
 * Path shapes people actually make. Most moves are a gentle arc; some are an S that crosses the straight
 * line; some drift wide (the eye wandered) and come back. The primary movement often stops a little short
 * or a little past the target and a short corrective movement finishes it.
 */
type Shape = 'arc' | 's' | 'wide';
function pickShape(d: number): Shape {
  const r = Math.random();
  if (d > 260 && r < 0.15) return 'wide';
  if (d > 120 && r < 0.45) return 's';
  return 'arc';
}

export function humanPath(from: { x: number; y: number }, to: { x: number; y: number }, targetWidth = 40, speed = 1): PathPoint[] {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (d < 2) return [{ x: to.x, y: to.y, dt: 16 }];
  const T = ((160 + 130 * Math.log2(d / Math.max(8, targetWidth) + 1)) * rnd(0.85, 1.2)) / speed;
  const nx = -dy / d, ny = dx / d;
  const side = Math.random() < 0.5 ? -1 : 1;
  const shape = pickShape(d);
  // Control-point offsets perpendicular to the straight line.
  const [b1, b2] =
    shape === 'wide' ? [side * d * rnd(0.3, 0.45), side * d * rnd(0.15, 0.3)] :
    shape === 's' ? [side * d * rnd(0.12, 0.25), -side * d * rnd(0.1, 0.22)] :
    [side * d * rnd(0.05, 0.2), side * d * rnd(0.02, 0.07)];
  // Where the primary (ballistic) movement ends: past the target, short of it, or on it.
  const r = Math.random();
  const miss = d > 180 && r < 0.3 ? rnd(0.025, 0.06) : d > 120 && r < 0.55 ? -rnd(0.04, 0.09) : 0;
  const off = Math.abs(miss) * d;
  const end = miss ? { x: to.x + (dx / d) * miss * d + gauss() * off * 0.25, y: to.y + (dy / d) * miss * d + gauss() * off * 0.25 } : to;
  const c1 = { x: from.x + dx * rnd(0.2, 0.4) + nx * b1, y: from.y + dy * rnd(0.2, 0.4) + ny * b1 };
  const c2 = { x: from.x + dx * rnd(0.6, 0.85) + nx * b2, y: from.y + dy * rnd(0.6, 0.85) + ny * b2 };
  // Tremor: a fast physiological component plus a slow drift, both fading as the hand settles.
  const ph1 = rnd(0, 6.28), ph2 = rnd(0, 6.28), f1 = rnd(14, 22), f2 = rnd(16, 26), fd = rnd(2, 4), amp = rnd(0.8, 1.8);
  // Sometimes the hand slows mid-way (re-aiming) before finishing the move.
  const hes = d > 200 && Math.random() < 0.2 ? rnd(0.4, 0.65) : -1;
  const n = Math.max(6, Math.round(T / 16));
  const pts: PathPoint[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const s = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5; // minimum-jerk
    const u = 1 - s;
    const fade = 1 - t;
    const tx = Math.sin(t * f1 + ph1) * amp + Math.sin(t * fd + ph2) * amp * 1.5;
    const ty = Math.sin(t * f2 + ph2) * amp + Math.cos(t * fd + ph1) * amp * 1.5;
    pts.push({
      x: u ** 3 * from.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s ** 3 * end.x + tx * fade,
      y: u ** 3 * from.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s ** 3 * end.y + ty * fade,
      dt: (T / n) * rnd(0.8, 1.2) * (hes > 0 && Math.abs(t - hes) < 0.08 ? rnd(2, 3.2) : 1),
    });
  }
  if (miss) {
    // Corrective sub-movement after a short reaction pause.
    pts[pts.length - 1].dt += rnd(40, 110) / speed;
    const m = Math.round(rnd(5, 9));
    for (let i = 1; i <= m; i++) {
      const t = i / m, s = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
      pts.push({ x: end.x + (to.x - end.x) * s, y: end.y + (to.y - end.y) * s, dt: rnd(14, 22) / speed });
    }
  }
  const last = pts[pts.length - 1];
  last.x = to.x; last.y = to.y;
  return pts;
}

/**
 * Where an idle hand drifts next while the agent is thinking: mostly a small settle near where it is,
 * sometimes toward something on the page it is "reading" (given as candidate points).
 */
export function idleTarget(at: { x: number; y: number }, view: { width: number; height: number }, poi: { x: number; y: number }[]): { x: number; y: number; slow: number } {
  const clampX = (x: number) => Math.min(view.width - 12, Math.max(12, x));
  const clampY = (y: number) => Math.min(view.height - 12, Math.max(12, y));
  if (poi.length && Math.random() < 0.55) {
    // Prefer nearby things, like a reader's eye moving down the page.
    const scored = poi.map((p) => ({ p, w: 1 / (40 + Math.hypot(p.x - at.x, p.y - at.y)) + (p.y > at.y ? 0.004 : 0) }));
    let k = Math.random() * scored.reduce((a, b) => a + b.w, 0);
    for (const c of scored) { k -= c.w; if (k <= 0) return { x: clampX(c.p.x + gauss() * 10), y: clampY(c.p.y + gauss() * 6), slow: rnd(0.35, 0.6) }; }
  }
  const r = rnd(10, 70), a = rnd(0, 6.28);
  return { x: clampX(at.x + Math.cos(a) * r), y: clampY(at.y + Math.sin(a) * r * 0.7), slow: rnd(0.25, 0.45) };
}

/** Inter-key delays: lognormal-ish rhythm, slower after spaces/punctuation, occasional thinking pause. */
export function typingDelays(text: string, wpm = 70): number[] {
  const base = 60_000 / (wpm * 5);
  return [...text].map((ch, i) => {
    let d = base * Math.exp(gauss() * 0.35);
    if (ch === ' ') d *= rnd(1.2, 1.8);
    if (/[.,;:!?@]/.test(ch)) d *= rnd(1.4, 2.2);
    if (/[A-Z]/.test(ch)) d *= 1.25; // shift
    if (i > 0 && i % Math.round(rnd(12, 30)) === 0) d += rnd(120, 380);
    return Math.max(18, Math.min(600, d));
  });
}
