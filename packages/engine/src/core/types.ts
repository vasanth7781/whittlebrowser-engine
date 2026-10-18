/** Wire types shared by the in-page agent (src/page) and the Node side (core, driver). */

/** One node of the pruned page tree produced by the in-page agent. Short keys keep the CDP payload small. */
export interface RawNode {
  /** Stable ref, unique for the session. Present on interactive nodes and on structural containers. */
  r?: number;
  /** ARIA role, or one of: text, line (inline run), clickable (cursor/tabindex heuristic), file, iframe. */
  role: string;
  name?: string;
  /** Current value of a control. Sensitive values are masked inside the page and never leave it. */
  val?: string;
  /** Space-separated states: checked disabled expanded collapsed selected required invalid readonly pressed focused. */
  st?: string;
  /** Heading level. */
  lvl?: number;
  /** 1 when the node is outside the current viewport. */
  off?: 1;
  /** 1 when the node renders inline (used to join runs onto one line). */
  il?: 1;
  /** Sensitive-field kind: password, card, otp, id, secret, pin. */
  sens?: string;
  /** First few options of a select/listbox and the total count. */
  opts?: string[];
  nopt?: number;
  href?: string;
  /** Table shape (rows x cols) for table/grid containers. */
  shape?: [number, number];
  kids?: RawNode[];
  /** Internal: text sealed by a block boundary (not merged with neighbours). */
  _s?: 1;
}

export interface PageSignals {
  password: number;
  card: number;
  otp: number;
  idField: number;
  secretField: number;
  /** Bot challenge detected (cloudflare, recaptcha, hcaptcha, ...), or empty. */
  challenge: string;
  /** Cross-origin iframes we could not descend into. */
  xframes: number;
}

export interface SnapshotStats {
  nodes: number;
  /** Text dropped because it was display:none-adjacent, sr-only, off-document, tiny or low-contrast. */
  hiddenText: number;
  /** Subset of hiddenText that looked deliberately deceptive (low-contrast, tiny font, opacity 0). */
  deceptiveText: number;
  truncated: boolean;
  ms: number;
  /** A few samples of dropped hidden text, used locally for injection detection; never emitted. */
  hiddenSamples?: string[];
}

export interface RawSnapshot {
  url: string;
  title: string;
  /** Viewport size and scroll position, in CSS px. */
  vw: number;
  vh: number;
  sy: number;
  sh: number;
  focus?: number;
  root: RawNode;
  stats: SnapshotStats;
  signals: PageSignals;
  nextRef: number;
}

export interface FindHit {
  r?: number;
  role: string;
  name: string;
  val?: string;
  st?: string;
  href?: string;
  /** Nearest heading or landmark, for orientation. */
  ctx?: string;
  off?: 1;
  score: number;
}

export interface PointResult {
  x: number;
  y: number;
  ok: boolean;
  /** Description of the element covering the target, when the hit test fails. */
  obscuredBy?: string;
  obscuredRef?: number;
  /** Target box in top-level viewport coordinates. */
  rect?: { x: number; y: number; width: number; height: number };
}

export interface Describe {
  role: string;
  name: string;
  tag: string;
  sens?: string;
  type?: string;
  href?: string;
  form?: boolean;
  /** Name of the form's submit button, so pressing Enter in a field can be judged by what it would submit. */
  submit?: string;
  checked?: boolean;
}

export type ObserveMode = 'actions' | 'read' | 'full';
