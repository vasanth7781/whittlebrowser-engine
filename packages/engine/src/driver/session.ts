/**
 * Session: the agent-facing API. Every method returns compact text that has already passed through
 * the policy gate (site AI mode, auto-pause) and the privacy filter.
 *
 *   observe  -> full view within a token budget
 *   act      -> one or more steps, then an outcome report + diff of what changed
 *   navigate -> go somewhere, returns the new view
 *   find     -> grep the page (including off-screen) instead of reading it
 *   extract  -> typed data: table, list (repeated items -> rows), text (main content as markdown)
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath, relative, isAbsolute, basename } from 'node:path';
import type { BrowserContext, Page, Dialog, Download } from 'playwright-core';
import { PageAgent } from './page-agent.js';
import type { Policy, AgentEvent } from './policy.js';
import { Privacy } from '../core/privacy.js';
import { render, renderLines, diffProfile, header, type Line } from '../core/serialize.js';
import { diffLines } from '../core/diff.js';
import { assess, type Assessment } from '../core/detector.js';
import { classifyAction } from '../core/risk.js';
import { estimateTokens } from '../core/tokens.js';
import { compactUrl, originOf, hostOf, toUrl } from '../core/url.js';
import { INJECTION_SOURCES, looksLikeInjection } from '../core/injection.js';
import { digest } from '../core/digest.js';
import { humanPath, idleTarget, landingPoint, typingDelays } from '../core/humanpath.js';
import { parseRobots, robotsAllows, type RobotsRules } from '../core/robots.js';
import type { RawSnapshot, FindHit, PointResult, Describe, ObserveMode } from '../core/types.js';

export interface SessionOptions {
  /** Token budget for a full observation. */
  budget?: number;
  /** Token cap for a post-action diff before it is truncated. */
  diffMax?: number;
  /** Eased mouse paths and variable typing (for demos/recordings). Off by default: it costs time. */
  humanize?: boolean;
  robots?: 'off' | 'warn' | 'enforce';
  /** Append an "WhittleBrowser" token to the User-Agent so sites can tell an agent is driving. */
  identify?: boolean;
  /** Let the agent open file: and data: URLs. Off by default: a hostile page could make the agent read local files. */
  allowFileUrls?: boolean;
  downloadsDir?: string;
  /** Files may only be uploaded from here without approval. */
  uploadDir?: string;
  /** Ignore pages whose URL starts with one of these (e.g. a host app's own UI). */
  ignoreUrlPrefixes?: string[];
  /** Animate a ghost cursor + target ring before each action so people can watch the agent. */
  showCursor?: boolean;
  /** Draw the X-ray overlay (refs, masked fields, withheld text) on pages the agent touches. */
  xray?: boolean;
}

export type Step =
  | { do: 'click'; ref: number }
  | { do: 'type'; ref: number; text: string; submit?: boolean; append?: boolean }
  | { do: 'select'; ref: number; values: string[] }
  | { do: 'check' | 'uncheck'; ref: number }
  | { do: 'hover'; ref: number }
  | { do: 'press'; key: string; ref?: number }
  | { do: 'scroll'; ref?: number; dy?: number }
  | { do: 'upload'; ref: number; files: string[] };

export interface TraceEntry {
  tool: string;
  args: unknown;
  tokens: number;
  ms: number;
  ok: boolean;
}

const AGENT_UA = 'WhittleBrowser/0.1 (+https://github.com/vasanth7781/whittlebrowser-engine; AI agent acting for a user)';

export class Session {
  private agents = new WeakMap<Page, PageAgent>();
  private baselines = new WeakMap<Page, { lines: Line[]; url: string; tokens: number; assessment: Assessment }>();
  private activePage: Page | null = null;
  private nextRef = 1;
  private approvedSites = new Set<string>();
  private robotsCache = new Map<string, RobotsRules | null>();
  private events: string[] = [];
  readonly privacy: Privacy;
  readonly trace: TraceEntry[] = [];
  private opts: Required<Omit<SessionOptions, 'ignoreUrlPrefixes'>> & { ignoreUrlPrefixes: string[] };
  private uaSet = new WeakSet<Page>();
  /** >0 while research opens background tabs: new pages must not steal focus. */
  private quietOpen = 0;

  constructor(readonly context: BrowserContext, readonly policy: Policy, opts: SessionOptions = {}, privacy?: Privacy) {
    this.privacy = privacy || new Privacy();
    this.opts = {
      budget: opts.budget ?? 2500,
      diffMax: opts.diffMax ?? 1500,
      humanize: opts.humanize ?? false,
      robots: opts.robots ?? 'warn',
      identify: opts.identify ?? true,
      allowFileUrls: opts.allowFileUrls ?? false,
      downloadsDir: opts.downloadsDir ?? join(homedir(), 'Downloads', 'whittlebrowser'),
      uploadDir: opts.uploadDir ?? join(homedir(), 'Downloads', 'whittlebrowser'),
      ignoreUrlPrefixes: opts.ignoreUrlPrefixes ?? ['wbui:', 'devtools:', 'chrome-extension:'],
      showCursor: opts.showCursor ?? false,
      xray: opts.xray ?? false,
    };
    for (const p of context.pages()) this.wire(p);
    context.on('page', (p) => {
      this.wire(p);
      if (this.isUserPage(p) && !this.quietOpen) {
        this.events.push(`⧉ new tab ${this.tabIndex(p)} opened (now active)`);
        this.activePage = p;
      }
    });
  }

  // ---------- pages & wiring ----------
  private isUserPage(p: Page): boolean {
    const u = p.url();
    return !p.isClosed() && !this.hidden.has(p) && !this.opts.ignoreUrlPrefixes.some((x) => u.startsWith(x));
  }

  /** Pages the host says agents must not see (a host app's private tabs). */
  private hidden = new WeakSet<Page>();
  private targetIds = new WeakMap<Page, string>();
  private async refreshHidden() {
    if (!this.policy.excludedTargets) return;
    const ids = new Set(await this.policy.excludedTargets().catch(() => [] as string[]));
    for (const p of this.context.pages()) {
      if (p.isClosed()) continue;
      let id = this.targetIds.get(p);
      if (!id) {
        try {
          const cdp = await this.context.newCDPSession(p);
          id = ((await cdp.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } }).targetInfo.targetId;
          await cdp.detach().catch(() => {});
          this.targetIds.set(p, id);
        } catch { continue; }
      }
      if (ids.has(id)) this.hidden.add(p);
      else this.hidden.delete(p);
    }
    if (this.activePage && this.hidden.has(this.activePage)) this.activePage = null;
  }

  pages(): Page[] {
    return this.context.pages().filter((p) => this.isUserPage(p));
  }

  private tabIndex(p: Page): number {
    return this.pages().indexOf(p);
  }

  private wire(p: Page) {
    p.on('dialog', (d: Dialog) => this.onDialog(d));
    p.on('download', (d: Download) => this.onDownload(d));
    p.on('close', () => {
      if (this.activePage === p) this.activePage = null;
    });
  }

  private pendingConfirm = false;
  private async onDialog(d: Dialog) {
    const msg = d.message().slice(0, 160);
    if (d.type() === 'beforeunload' || d.type() === 'alert') {
      this.events.push(`! ${d.type()} "${msg}" accepted`);
      await d.accept().catch(() => {});
    } else if (d.type() === 'confirm' && this.pendingConfirm) {
      this.events.push(`! confirm "${msg}" accepted`);
      await d.accept().catch(() => {});
    } else {
      this.events.push(`! ${d.type()} "${msg}" dismissed (repeat the action with confirm:true to accept)`);
      await d.dismiss().catch(() => {});
    }
  }

  private async onDownload(d: Download) {
    mkdirSync(this.opts.downloadsDir, { recursive: true });
    const target = join(this.opts.downloadsDir, basename(d.suggestedFilename()));
    try {
      await d.saveAs(target);
      this.events.push(`↧ downloaded ${basename(target)} → ${target.replace(homedir(), '~')}`);
    } catch (e) {
      this.events.push(`↧ download failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  async page(): Promise<Page> {
    this.idleGen++; // a tool call started: the idle hand stops
    await this.refreshHidden();
    if (this.activePage && !this.activePage.isClosed()) {
      await this.identify(this.activePage);
      return this.activePage;
    }
    const ps = this.pages();
    if (ps.length) this.activePage = ps[ps.length - 1];
    else {
      this.activePage = await this.context.newPage();
      this.events = this.events.filter((e) => !e.startsWith('⧉'));
    }
    await this.identify(this.activePage);
    return this.activePage;
  }

  /** Adds the agent token to this tab's User-Agent. Must happen before the tab loads anything, so it is done as the tab is handed out. */
  private async identify(p: Page) {
    if (!this.opts.identify || this.uaSet.has(p)) return;
    this.uaSet.add(p);
    try {
      const cdp = await p.context().newCDPSession(p);
      const ua = (await p.evaluate(() => navigator.userAgent).catch(() => '')) as string;
      if (ua && !ua.includes('WhittleBrowser/')) await cdp.send('Emulation.setUserAgentOverride', { userAgent: `${ua} ${AGENT_UA}` });
    } catch {
      /* best effort */
    }
  }

  private async agent(p: Page): Promise<PageAgent> {
    let a = this.agents.get(p);
    if (!a) {
      a = new PageAgent(p, () => this.nextRef, () => ({ engine: true, inj: INJECTION_SOURCES, xray: this.opts.xray || undefined }));
      this.agents.set(p, a);
    }
    await this.identify(p);
    return a;
  }

  private async snap(p: Page, root?: number): Promise<RawSnapshot> {
    const a = await this.agent(p);
    await a.syncRefs(this.nextRef);
    await a.probeClicks();
    const s = await a.call<RawSnapshot>('snapshot', root ? { root } : {});
    this.nextRef = Math.max(this.nextRef, s.nextRef);
    return s;
  }

  /** Live progress for watchers (a host app's panel). Not sent to the model, so not counted as tokens. */
  private live(origin: string, text: string) {
    this.policy.log?.({ type: 'step', origin, text: this.privacy.scrub(text), tokens: 0, at: Date.now() });
  }

  /**
   * Resolve where to act on a ref. With the cursor shown or humanize on, the real mouse travels there
   * along a human-like path (the ghost cursor draws it) and lands inside the target, not on its centre.
   */
  private async showAt(p: Page, a: PageAgent, ref: number, label: string): Promise<PointResult | { error: string }> {
    const pt = await a.call<PointResult | { error: string }>('point', ref);
    if ('error' in pt || !pt.ok) return pt;
    if (this.opts.showCursor) {
      // Start the real move where the idle drift left the drawn cursor, so it never jumps.
      const g = await a.call<{ x: number; y: number } | null>('ghostStop').catch(() => null);
      if (g) this.mouse = g;
    }
    if (this.opts.showCursor) await a.call('cursor', { ref, label: this.privacy.scrub(label), x: this.mouse.x, y: this.mouse.y }).catch(() => {});
    if (this.opts.showCursor || this.opts.humanize) {
      const r = pt.rect;
      // Stay in the middle 60% of the box so irregular shapes (pills, icons) still receive the click.
      const land = r ? landingPoint({ x: r.x + r.width * 0.2, y: r.y + r.height * 0.2, width: r.width * 0.6, height: r.height * 0.6 }, pt) : pt;
      pt.x = Math.round(land.x);
      pt.y = Math.round(land.y);
      await this.moveMouse(p, pt.x, pt.y, r?.width);
    }
    return pt;
  }

  // ---------- output choke point ----------
  /**
   * @param naive tokens a full, unfolded dump of the same page would have cost (for the savings meter).
   */
  private emit(type: AgentEvent['type'], origin: string, text: string, t0: number, args: unknown, ok = true, naive = 0): string {
    const before = Object.values(this.privacy.stats).reduce((a, b) => a + b, 0);
    const out = this.privacy.scrub(text);
    const redactions = Object.values(this.privacy.stats).reduce((a, b) => a + b, 0) - before + (out.match(/•••/g)?.length ?? 0);
    const tokens = estimateTokens(out);
    this.trace.push({ tool: type, args, tokens, ms: Date.now() - t0, ok });
    const injections = out.split('\n').filter((l) => l.includes('⚠')).length;
    this.policy.log?.({ type, origin, text: out, tokens, at: Date.now(), meta: { saved: Math.max(0, naive - tokens), injections, redactions } });
    this.kickIdle();
    return out;
  }

  // ---------- idle hand ----------
  /**
   * While the model thinks between tool calls, the drawn cursor drifts the way an idle hand does: small
   * settles, and slow moves toward headings and text as if reading (right after a page opens, too).
   * Drawn only: no mouse events reach the page, so nothing hovers, opens or changes. Stops at the next call.
   */
  private idleGen = 0;
  private kickIdle() {
    if (!this.opts.showCursor) return;
    const p = this.activePage;
    if (!p || p.isClosed()) return;
    const gen = ++this.idleGen;
    void this.idleLoop(p, gen).catch(() => {});
  }
  private async idleLoop(p: Page, gen: number) {
    const live = () => gen === this.idleGen && !p.isClosed();
    const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await nap(250 + Math.random() * 500);
    if (!live()) return;
    const a = await this.agent(p);
    let view = await a.call<{ w: number; h: number; pts: { x: number; y: number }[] }>('readingPoints');
    let at = await a.call<{ x: number; y: number } | null>('ghostStop');
    if (!at) {
      // Fresh page: the cursor appears where the hand was and starts reading.
      at = this.mouse.x || this.mouse.y ? { ...this.mouse } : { x: Math.round(view.w * 0.55), y: Math.round(view.h * 0.7) };
      if (!live()) return;
      await a.call('cursor', { x: at.x, y: at.y });
    }
    const until = Date.now() + 25_000;
    while (live() && Date.now() < until) {
      const tgt = idleTarget(at, { width: view.w, height: view.h }, view.pts);
      if (!live()) return;
      const ms = await a.call<number>('ghostPath', humanPath(at, tgt, 80, tgt.slow));
      if (ms < 0) return; // the user moved the mouse
      at = { x: tgt.x, y: tgt.y };
      await nap(ms + 300 + Math.random() * 1900);
      if (live() && Math.random() < 0.3) view = await a.call('readingPoints');
    }
  }

  private drainEvents(): string[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- gates ----------
  private async siteGate(p: Page): Promise<string | null> {
    const url = p.url();
    const origin = originOf(url);
    if (!origin || url === 'about:blank' || url.startsWith('data:')) return null;
    let mode = await this.policy.siteMode(origin);
    if (mode === 'ask' && !this.approvedSites.has(origin)) {
      const a = await this.policy.approve({ kind: 'site', origin, summary: `Let the AI read and act on ${hostOf(url)}?` });
      if (a === 'yes') this.approvedSites.add(origin);
      else mode = 'off';
    }
    if (mode === 'off') return `⏸ AI is off for ${hostOf(url)}. Nothing from this page was sent. Ask the user to switch the AI dot to Allowed, or navigate elsewhere.`;
    return null;
  }

  private async sensitiveGate(url: string, s: RawSnapshot): Promise<{ block: string | null; assessment: Assessment }> {
    const assessment = assess(url, s.signals, { allow: await this.policy.allowedSensitiveHosts() });
    if (assessment.level === 'pause') {
      return {
        assessment,
        block: `⏸ AI auto-paused on ${hostOf(url)}: ${assessment.reasons.join(', ')}. Nothing from this page was sent. The user can take over here, or allow this site (host app: its AI control · MCP: --allow-site ${hostOf(url)}).`,
      };
    }
    return { block: null, assessment };
  }

  private cautionNote(a: Assessment): string[] {
    // Bot challenges get their own ⚠ note from the serializer; only field-related reasons belong here.
    const fields = a.reasons.filter((r) => !r.startsWith('bot challenge'));
    return a.level === 'caution' && fields.length ? [`⚿ ${fields.join(', ')}: values are masked; type secrets as secret:NAME (vault: ${this.privacy.vaultNames().join(', ') || 'empty'})`] : [];
  }

  // ---------- observe ----------
  async observe(o: { mode?: ObserveMode; ref?: number; budget?: number } = {}): Promise<string> {
    const t0 = Date.now();
    const p = await this.page();
    const origin = originOf(p.url());
    const blocked = await this.siteGate(p);
    if (blocked) return this.emit('blocked', origin, blocked, t0, o, false);
    if (o.mode === 'read') return this.extract({ kind: 'text', ref: o.ref });
    const s = await this.snap(p, o.ref);
    const { block, assessment } = await this.sensitiveGate(s.url, s);
    if (block) return this.emit('blocked', origin, block, t0, o, false);
    const r = render(s, { mode: o.mode, budget: o.budget ?? this.opts.budget, expand: !!o.ref });
    if (!o.ref) {
      const base = renderLines(s.root, diffProfile());
      this.baselines.set(p, { lines: base, url: s.url, tokens: r.tokens, assessment });
    }
    const text = [...this.drainEvents(), ...this.cautionNote(assessment), r.text].join('\n');
    return this.emit('observe', origin, text, t0, o, true, render(s, { mode: 'full' }).tokens);
  }

  // ---------- act ----------
  async act(steps: Step[], o: { confirm?: boolean } = {}): Promise<string> {
    const t0 = Date.now();
    let p = await this.page();
    const origin = originOf(p.url());
    const blocked = await this.siteGate(p);
    if (blocked) return this.emit('blocked', origin, blocked, t0, steps, false);
    let base = this.baselines.get(p);
    if (!base || base.url !== p.url()) {
      const s = await this.snap(p);
      const g = await this.sensitiveGate(s.url, s);
      if (g.block) return this.emit('blocked', origin, g.block, t0, steps, false);
      base = { lines: renderLines(s.root, diffProfile()), url: s.url, tokens: render(s, { budget: this.opts.budget }).tokens, assessment: g.assessment };
      this.baselines.set(p, base);
    } else if (base.assessment.level === 'pause') {
      return this.emit('blocked', origin, '⏸ AI auto-paused on this page.', t0, steps, false);
    }

    const a = await this.agent(p);
    const log: string[] = [];
    const urlBefore = p.url();
    this.pendingConfirm = !!o.confirm;
    let failed = false;
    let ran = 0;
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        this.live(origin, stepLabel(step));
        let res: { ok: boolean; line: string };
        try {
          res = await this.step(p, a, step, !!o.confirm);
        } catch (e) {
          // Keep what already ran in the report: a lost log makes the model repeat a step that worked.
          res = { ok: false, line: `✗ ${stepLabel(step)}: ${(e as Error).message.split('\n')[0].slice(0, 160)}` };
        }
        log.push(res.line);
        if (res.ok) ran++;
        if (!res.ok) {
          failed = true;
          if (steps.length > 1 && i < steps.length - 1) log.push(`(stopped: ${steps.length - i - 1} step(s) not run)`);
          break;
        }
        if (i < steps.length - 1) {
          if (p.url() !== urlBefore) {
            if (i < steps.length - 1) log.push(`(stopped after step ${i + 1}: page navigated; refs changed)`);
            break;
          }
          await a.call('waitQuiet', 120, 1500).catch(() => {});
        }
      }
      await this.settle(p, a, urlBefore);
    } finally {
      this.pendingConfirm = false;
    }

    // Nothing ran (refused, gone, covered): no need to look at the page again.
    if (!ran && p.url() === urlBefore && !this.events.length) return this.emit('act', origin, log.join('\n'), t0, steps, false);
    // A popup may have become the active page.
    const now = await this.page();
    if (now !== p) p = now;
    return this.report(p, base, log, urlBefore, t0, steps, !failed);
  }

  private async report(p: Page, base: { lines: Line[]; url: string; tokens: number } | undefined, log: string[], urlBefore: string, t0: number, args: unknown, ok = true): Promise<string> {
    const origin = originOf(p.url());
    const out = [...log];
    const blocked = await this.siteGate(p);
    if (blocked) {
      out.push(...this.drainEvents(), blocked);
      return this.emit('act', origin, out.join('\n'), t0, args, ok);
    }
    const s = await this.snap(p);
    const g = await this.sensitiveGate(s.url, s);
    if (g.block) {
      out.push(...this.drainEvents(), g.block);
      return this.emit('act', origin, out.join('\n'), t0, args, ok);
    }
    const navigated = s.url !== urlBefore;
    if (navigated) out.push(`→ ${compactUrl(urlBefore)} → ${compactUrl(s.url)} · "${s.title.slice(0, 70)}"`);
    out.push(...this.drainEvents(), ...this.cautionNote(g.assessment));
    const full = render(s, { budget: this.opts.budget });
    const lines = renderLines(s.root, diffProfile());
    let body: string;
    const samePageBase = base && !navigated && base.url.split('#')[0] === s.url.split('#')[0];
    const d = samePageBase ? diffLines(base!.lines, lines, full.tokens, this.opts.diffMax) : null;
    if (d) {
      body = d.added + d.removed + d.changed === 0 ? 'Δ no visible change' : `Δ +${d.added} −${d.removed} ~${d.changed}\n${d.text}`;
      const notes = full.text.split('\n').filter((l) => l.startsWith('⚠'));
      if (notes.length) body = notes.join('\n') + '\n' + body;
    } else body = full.text;
    this.baselines.set(p, { lines, url: s.url, tokens: full.tokens, assessment: g.assessment });
    out.push(body);
    return this.emit('act', origin, out.join('\n'), t0, args, ok, render(s, { mode: 'full' }).tokens);
  }

  private async settle(p: Page, a: PageAgent, urlBefore: string) {
    await new Promise((r) => setTimeout(r, 60));
    if (p.isClosed()) return;
    if (p.url() !== urlBefore) await p.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await Promise.all([a.networkIdle(300, 3000), a.call('waitQuiet', 200, 2500).catch(() => {})]);
  }

  private async resolveDescribe(p: Page, a: PageAgent, ref: number): Promise<Describe | null> {
    let d = await a.call<Describe | null>('describe', ref);
    if (!d) {
      // Element replaced by a re-render: a fresh snapshot remaps refs by fingerprint.
      await this.snap(p);
      d = await a.call<Describe | null>('describe', ref);
    }
    return d;
  }

  /** Asks for approval before an irreversible action. Returns the line to report if it must not run, else null. */
  private async riskGate(p: Page, kind: string, d: Describe | null, key: string | undefined, confirm: boolean, what: string): Promise<{ ok: false; line: string } | null> {
    const risk = classifyAction(kind, d, key);
    if (risk.risk !== 'high' || confirm) return null;
    const ans = await this.policy.approve({ kind: 'risk', origin: originOf(p.url()), summary: `${what}: ${risk.why}` });
    if (ans === 'no') return { ok: false, line: `✗ ${what}: refused by user (${risk.why})` };
    if (ans === 'confirm') return { ok: false, line: `⚠ ${what} not run: ${risk.why}. Get the user's OK, then repeat with confirm:true` };
    return null;
  }

  private async step(p: Page, a: PageAgent, s: Step, confirm: boolean): Promise<{ ok: boolean; line: string }> {
    const label = (d: Describe | null, ref: number) => `[${ref}]${d ? ` ${d.role || d.tag}${d.name ? ` "${d.name.slice(0, 50)}"` : ''}` : ''}`;
    const gone = (ref: number) => ({ ok: false, line: `✗ ${s.do} [${ref}]: element no longer exists; observe again` });

    if (s.do === 'press' && !s.ref) {
      // Enter or Space acts on whatever has focus: judge it like a click on that element.
      const focused = /^(enter|space| )$/i.test(s.key) ? await a.call<Describe | null>('describe', null) : null;
      const refused = await this.riskGate(p, 'press', focused, s.key, confirm, `press ${s.key}${focused ? ` on ${focused.role || focused.tag}${focused.name ? ` "${focused.name.slice(0, 50)}"` : ''}` : ''}`);
      if (refused) return refused;
      await p.keyboard.press(s.key);
      return { ok: true, line: `✓ press ${s.key}` };
    }
    if (s.do === 'scroll' && !s.ref) {
      const r = await a.call<{ sy: number; sh: number; atEnd: boolean }>('scroll', null, Math.round((s.dy ?? 1) * (p.viewportSize()?.height || 800) * 0.85));
      return { ok: true, line: `✓ scroll ${s.dy ?? 1} → ${Math.round((r.sy / Math.max(1, r.sh)) * 100)}%${r.atEnd ? ' (end)' : ''}` };
    }
    const ref = (s as { ref: number }).ref;
    const d = await this.resolveDescribe(p, a, ref);
    if (!d) return gone(ref);

    // type + submit presses Enter, so it is judged as that key press.
    const typesThenEnters = s.do === 'type' && s.submit;
    const refused = await this.riskGate(p, typesThenEnters ? 'press' : s.do, d, typesThenEnters ? 'Enter' : s.do === 'press' ? s.key : undefined, confirm, `${s.do} ${label(d, ref)}`);
    if (refused) return refused;

    switch (s.do) {
      case 'click':
      case 'hover':
      case 'check':
      case 'uncheck': {
        if ((s.do === 'check' && d.checked) || (s.do === 'uncheck' && !d.checked)) return { ok: true, line: `✓ ${s.do} ${label(d, ref)} (already)` };
        const pt = await this.showAt(p, a, ref, `${s.do} · ${d.name || d.role}`);
        if ('error' in pt) return gone(ref);
        if (!pt.ok) {
          return { ok: false, line: `✗ ${s.do} ${label(d, ref)}: covered by ${pt.obscuredBy}${pt.obscuredRef ? ' (close/dismiss it first)' : ''}` };
        }
        if (!this.opts.showCursor && !this.opts.humanize) await this.moveMouse(p, pt.x, pt.y);
        if (s.do !== 'hover') {
          if (this.opts.showCursor) a.call('clickFx').catch(() => {});
          await p.mouse.click(pt.x, pt.y, { delay: this.opts.humanize ? 40 + Math.random() * 60 : 0 });
        }
        return { ok: true, line: `✓ ${s.do} ${label(d, ref)}` };
      }
      case 'type': {
        const rv = this.privacy.reveal(s.text);
        if (rv.missing) return { ok: false, line: `✗ type [${ref}]: secret "${rv.missing}" not in vault (set WB_SECRET_${rv.missing.toUpperCase()} or ~/.whittlebrowser/secrets.json)` };
        if (this.opts.showCursor || this.opts.humanize) await this.showAt(p, a, ref, `type · ${d.name || d.role}`);
        const f = await a.call<{ ok: boolean; error?: string; kind?: string }>('focusForTyping', ref, !s.append);
        if (f.error === 'gone') return gone(ref);
        if (!f.ok) return { ok: false, line: `✗ type ${label(d, ref)}: could not focus` };
        if (rv.secret || f.kind) this.privacy.remember(rv.value, rv.secret ? 'typed' : f.kind || 'typed');
        if (!s.append) await p.keyboard.press('Delete').catch(() => {});
        if (rv.value.length > 80 && !this.opts.humanize) await p.keyboard.insertText(rv.value);
        else if (this.opts.humanize) {
          const delays = typingDelays(rv.value);
          for (let i = 0; i < rv.value.length; i++) {
            await p.keyboard.type(rv.value[i]);
            await new Promise((r) => setTimeout(r, delays[i]));
          }
        } else await p.keyboard.type(rv.value);
        const shown = rv.secret || f.kind ? (s.text.startsWith('secret:') ? `‹${s.text}›` : '•••') : `"${s.text.slice(0, 60)}"`;
        let line = `✓ type ${label(d, ref)} ${shown}`;
        if (s.submit) {
          await p.keyboard.press('Enter');
          line += ' + Enter';
        }
        return { ok: true, line };
      }
      case 'select': {
        if (this.opts.showCursor || this.opts.humanize) await this.showAt(p, a, ref, `select · ${s.values.join(', ')}`);
        const r = await a.call<{ ok: boolean; picked?: string[]; error?: string; options?: string[] }>('selectOption', ref, s.values);
        if (r.error === 'gone') return gone(ref);
        if (!r.ok) return { ok: false, line: `✗ select ${label(d, ref)}: ${r.error}${r.options ? ` · options: ${r.options.join(', ')}` : ''}` };
        return { ok: true, line: `✓ select ${label(d, ref)} = ${r.picked!.join(', ')}` };
      }
      case 'press': {
        await a.call('focusForTyping', ref, false);
        await p.keyboard.press(s.key);
        return { ok: true, line: `✓ press ${s.key} on ${label(d, ref)}` };
      }
      case 'scroll': {
        await a.call('scroll', ref, s.dy ? Math.round(s.dy * (p.viewportSize()?.height || 800) * 0.85) : 0);
        return { ok: true, line: `✓ scroll ${label(d, ref)}` };
      }
      case 'upload': {
        const files = s.files.map((f) => resolvePath(f.replace(/^~/, homedir())));
        const outside = files.filter((f) => { const r = relative(this.opts.uploadDir, f); return r.startsWith('..') || isAbsolute(r); });
        if (outside.length && !confirm) {
          const ans = await this.policy.approve({ kind: 'risk', origin: originOf(p.url()), summary: `upload ${outside.join(', ')} (outside ${this.opts.uploadDir})` });
          if (ans !== 'yes') return { ok: false, line: `⚠ upload not run: files outside ${this.opts.uploadDir.replace(homedir(), '~')} need the user's OK, then repeat with confirm:true` };
        }
        await a.setFiles(ref, files);
        return { ok: true, line: `✓ upload ${files.map((f) => basename(f)).join(', ')} → ${label(d, ref)}` };
      }
    }
  }

  private mouse = { x: 0, y: 0 };
  private async moveMouse(p: Page, x: number, y: number, targetWidth = 40) {
    if (!this.opts.humanize && !this.opts.showCursor) {
      await p.mouse.move(x, y);
    } else {
      // Human-like path for people watching (see core/humanpath.ts); not an evasion technique.
      const vs = p.viewportSize();
      const from = this.mouse.x || this.mouse.y ? this.mouse : { x: (vs?.width ?? 1280) * 0.55, y: (vs?.height ?? 800) * 0.8 };
      for (const pt of humanPath(from, { x, y }, targetWidth, this.opts.humanize ? 1 : 1.6)) {
        await p.mouse.move(pt.x, pt.y);
        await new Promise((r) => setTimeout(r, pt.dt));
      }
    }
    this.mouse = { x, y };
  }

  // ---------- navigate ----------
  async navigate(target: string, o: { confirm?: boolean } = {}): Promise<string> {
    const t0 = Date.now();
    const p = await this.page();
    const before = p.url();
    if (target === 'back' || target === 'forward' || target === 'reload') {
      if (target === 'back') await p.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      else if (target === 'forward') await p.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      else await p.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      await this.settle(p, await this.agent(p), p.url());
      return this.report(p, undefined, [`✓ ${target}`], before, t0, { target });
    }
    let url = toUrl(target, 'https://duckduckgo.com/html/?q=%s');
    url = this.privacy.reveal(url).value;
    const problem = await this.urlProblem(url, before, { confirm: o.confirm });
    if (problem) return this.emit('navigate', problem.origin, problem.text, t0, { target }, false);
    const u = new URL(url);
    const notes: string[] = [];
    if (this.opts.robots === 'warn' && /^https?:$/.test(u.protocol) && !(await this.robotsOk(u))) {
      notes.push(`note: robots.txt disallows this path for automated agents`);
    }
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0].slice(0, 140);
      return this.emit('navigate', u.origin, `✗ navigate ${compactUrl(url)}: ${msg}`, t0, { target }, false);
    }
    await this.settle(p, await this.agent(p), p.url());
    return this.report(p, undefined, notes, before, t0, { target });
  }

  /**
   * Why the agent may not open this URL, or null if it may. Every way the agent can open a page (navigate, research,
   * tabs) goes through here: only http(s) unless file URLs are enabled, approval for a data-carrying jump to another
   * site (the shape of a prompt-injected "visit evil.com/?q=<secret>"), and robots.txt when it is enforced.
   */
  private async urlProblem(raw: string, from: string, o: { confirm?: boolean; checkJump?: boolean } = {}): Promise<{ text: string; origin: string } | null> {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { text: '✗ invalid URL', origin: '' };
    }
    const ok = raw === 'about:blank' || (this.opts.allowFileUrls ? /^(https?|file|data):$/ : /^https?:$/).test(u.protocol);
    if (!ok) {
      const hint = u.protocol === 'file:' || u.protocol === 'data:' ? ' (the server must be started with --allow-file-urls)' : '';
      return { text: `✗ ${u.protocol} URLs are not allowed${hint}`, origin: '' };
    }
    const fromOrigin = originOf(from);
    if (!o.confirm && o.checkJump !== false && fromOrigin && fromOrigin !== u.origin && (u.search.length > 64 || u.hash.length > 64) && from !== 'about:blank') {
      const ans = await this.policy.approve({ kind: 'navigate', origin: u.origin, summary: `open ${compactUrl(raw)} with a long query from ${hostOf(from)}` });
      if (ans !== 'yes') return { text: `⚠ not opened: ${u.host} with a ${u.search.length + u.hash.length}-char query could carry data out of ${hostOf(from)}. Get the user's OK, then repeat with confirm:true`, origin: fromOrigin };
    }
    if (this.opts.robots === 'enforce' && /^https?:$/.test(u.protocol) && !(await this.robotsOk(u))) {
      return { text: `✗ ${u.host}/robots.txt disallows ${u.pathname} for agents`, origin: u.origin };
    }
    return null;
  }

  private async robotsOk(u: URL): Promise<boolean> {
    let rules = this.robotsCache.get(u.origin);
    if (rules === undefined) {
      try {
        const r = await fetch(u.origin + '/robots.txt', { signal: AbortSignal.timeout(2500), headers: { 'user-agent': AGENT_UA } });
        rules = r.ok ? parseRobots(await r.text(), 'WhittleBrowser') : null;
      } catch {
        rules = null;
      }
      this.robotsCache.set(u.origin, rules);
    }
    return !rules || robotsAllows(rules, u.pathname + u.search);
  }

  // ---------- find ----------
  async find(query: string, limit = 12): Promise<string> {
    const t0 = Date.now();
    const p = await this.page();
    const origin = originOf(p.url());
    const blocked = await this.siteGate(p);
    if (blocked) return this.emit('blocked', origin, blocked, t0, { query }, false);
    const s = await this.snap(p);
    const g = await this.sensitiveGate(s.url, s);
    if (g.block) return this.emit('blocked', origin, g.block, t0, { query }, false);
    const a = await this.agent(p);
    const css = query.match(/^css:\s*(.+)$/is);
    if (css) {
      const r = await a.call<{ total: number; shown: number; hits: { tag: string; text: string; attrs: string[]; r?: number }[] } | { error: string }>('query', css[1].trim(), limit);
      const text = 'error' in r
        ? `✗ find css: ${r.error}`
        : [`css ${css[1].trim()}: ${r.total} visible match(es)${r.shown < r.total ? `, showing ${r.shown}` : ''}`, ...r.hits.map((h) => `${h.r ? `[${h.r}] ` : ''}<${h.tag}>${h.text ? ` "${h.text}"` : ''} ${h.attrs.join(' ')}`.trimEnd())].join('\n');
      return this.emit('find', origin, flagInjection(text), t0, { query });
    }
    const hits = await a.call<FindHit[]>('find', query, limit);
    const lines = hits.map((h) => {
      let t = h.r ? `[${h.r}] ${h.role}` : h.role;
      if (h.name) t += ` "${h.name}"`;
      if (h.val && h.val !== '•••') t += ` = "${h.val}"`;
      if (h.st) t += ' ' + h.st;
      if (h.href && h.role === 'link') t += ` <${h.href.length > 80 ? h.href.slice(0, 79) + '…' : h.href}>`;
      if (h.ctx) t += ` · in "${h.ctx}"`;
      if (h.off) t += ' ↓';
      return t;
    });
    const text = lines.length ? `find "${query}": ${lines.length} hit(s)\n${flagInjection(lines.join('\n'))}` : `find "${query}": no matches (try fewer words, or role:button …)`;
    return this.emit('find', origin, text, t0, { query });
  }

  // ---------- extract ----------
  async extract(o: { kind: 'table' | 'list' | 'text'; ref?: number; offset?: number; links?: boolean; budget?: number }): Promise<string> {
    const t0 = Date.now();
    const p = await this.page();
    const origin = originOf(p.url());
    const blocked = await this.siteGate(p);
    if (blocked) return this.emit('blocked', origin, blocked, t0, o, false);
    const s = await this.snap(p);
    const g = await this.sensitiveGate(s.url, s);
    if (g.block) return this.emit('blocked', origin, g.block, t0, o, false);
    const a = await this.agent(p);
    const budget = o.budget ?? this.opts.budget * 1.6;
    const offset = o.offset ?? 0;
    let text: string;
    if (o.kind === 'table') {
      const r = await a.call<{ rows: string[][]; total: number; header?: string[] } | { error: string }>('table', o.ref ?? null, offset, 60);
      if ('error' in r) text = `✗ extract table: ${r.error}`;
      else {
        const rows = r.rows.map((c) => c.join(' | '));
        const head = r.header ? r.header.join(' | ') : '';
        const fit = fitLines(rows, budget - estimateTokens(head) - 30);
        const end = offset + fit.length;
        text = flagInjection([`table rows ${offset + 1}-${end} of ${r.total}${end < r.total ? ` (next: offset=${end})` : ''}`, head, ...fit].filter(Boolean).join('\n'));
      }
    } else if (o.kind === 'list') {
      const r = await a.call<{ cols: string[]; rows: string[][]; total: number } | { error: string }>('list', o.ref ?? null, offset, 80);
      if ('error' in r) text = `✗ extract list: ${r.error}`;
      else {
        const rows = r.rows.map((c, i) => `${offset + i + 1}. ${c.filter(Boolean).join(' | ')}`);
        const fit = fitLines(rows, budget - 30);
        const end = offset + fit.length;
        text = flagInjection([`${r.total} items · cols: ${r.cols.join(', ')}${end < r.total ? ` · showing ${offset + 1}-${end} (next: offset=${end})` : ''}`, ...fit].join('\n'));
      }
    } else {
      const r = await a.call<{ md: string; ref?: number } | { error: string }>('read', o.ref ?? null, !!o.links);
      if ('error' in r) text = `✗ extract text: ${r.error}`;
      else {
        const maxChars = Math.floor(budget * 3.6);
        const chunk = r.md.slice(offset, offset + maxChars);
        const end = offset + chunk.length;
        text = [header(s), flagInjection(chunk), end < r.md.length ? `… (chars ${offset}-${end} of ${r.md.length}; next: offset=${end})` : ''].filter(Boolean).join('\n');
      }
    }
    return this.emit('extract', origin, text, t0, o);
  }

  // ---------- research: many pages in parallel, one compact digest ----------
  async research(o: { urls?: string[]; limit?: number; budget?: number; keep?: boolean }): Promise<string> {
    const t0 = Date.now();
    const limit = Math.min(Math.max(o.limit ?? 5, 1), 8);
    const per = Math.max(150, Math.min(o.budget ?? 450, 1500));
    const from = await this.page();
    const origin = originOf(from.url());
    let targets: { url: string; text: string }[] = (o.urls || []).map((u) => ({ url: toUrl(u), text: '' }));
    if (!targets.length) {
      const blocked = await this.siteGate(from);
      if (blocked) return this.emit('blocked', origin, blocked, t0, o, false);
      const s = await this.snap(from);
      const g = await this.sensitiveGate(s.url, s);
      if (g.block) return this.emit('blocked', origin, g.block, t0, o, false);
      targets = await (await this.agent(from)).call<{ url: string; text: string }[]>('topLinks', limit);
      if (!targets.length) return this.emit('research', origin, '✗ research: no result links found on this page; pass urls', t0, o, false);
    }
    targets = targets.slice(0, limit);
    // URLs the model chose are checked like navigate; links taken from the page only need a safe scheme.
    const problems = await Promise.all(targets.map((t) => this.urlProblem(t.url, from.url(), { checkJump: !!o.urls?.length })));
    this.live(origin, `research · opening ${targets.length} pages in parallel`);

    // Open every tab first (loads overlap), then read them concurrently.
    this.quietOpen++;
    const pages: (Page | null)[] = [];
    try {
      for (let i = 0; i < targets.length; i++) pages.push(problems[i] ? null : await this.openBackground(targets[i].url));
    } finally {
      this.quietOpen--;
    }
    const fulls: number[] = [];
    const results = await Promise.all(targets.map(async (t, i) => {
      const p = pages[i];
      const host = hostOf(t.url);
      if (!p) return `## ${i + 1}. ${host || targets[i].url.slice(0, 40)}
${problems[i]?.text ?? '✗ could not open'}`;
      try {
        await p.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        const a = await this.agent(p);
        await a.networkIdle(400, 2500);
        const blocked = await this.siteGate(p);
        if (blocked) return `## ${i + 1}. ${host}
${blocked}`;
        const s = await this.snap(p);
        const g = await this.sensitiveGate(s.url, s);
        if (g.block) return `## ${i + 1}. ${host}
${g.block}`;
        this.live(originOf(p.url()), `research · reading ${host}`);
        fulls.push(render(s, { mode: 'full' }).tokens);
        const r = await a.call<{ md: string } | { error: string }>('read', null, false);
        const body = 'error' in r ? `✗ ${r.error}` : flagInjection(digest(r.md.replace(/^# .*\n?/, ''), per));
        const warn = s.signals.challenge ? `\n⚠ bot challenge: needs the user (tab ${this.tabIndex(p)})` : '';
        return `## ${i + 1}. ${s.title.slice(0, 90)} · ${compactUrl(s.url)}${warn}\n${body}`;
      } catch (e) {
        return `## ${i + 1}. ${host}\n✗ ${(e as Error).message.split('\n')[0].slice(0, 120)}`;
      }
    }));
    if (!o.keep) for (const p of pages) if (p && p !== from) await p.close().catch(() => {});
    this.activePage = from.isClosed() ? null : from;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const naive = fulls.reduce((a, b) => a + b, 0);
    const text = `research: ${targets.length} pages in ${secs}s (parallel)${o.keep ? ' · tabs kept open' : ''}\n\n${results.join('\n\n')}`;
    return this.emit('research', origin, text, t0, o, true, naive);
  }

  private async openBackground(url: string): Promise<Page | null> {
    if (this.policy.openTab) {
      const created = this.context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
      if (!(await this.policy.openTab(url, { background: true, agent: true }))) return null;
      return created;
    }
    const p = await this.context.newPage();
    await this.identify(p); // before the first request, not after it
    p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
    return p;
  }

  // ---------- tabs ----------
  async tabs(o: { op: 'list' | 'open' | 'switch' | 'close'; url?: string; index?: number }): Promise<string> {
    const t0 = Date.now();
    await this.refreshHidden();
    if (o.op === 'open' && o.url) {
      const problem = await this.urlProblem(toUrl(o.url), (await this.page()).url());
      if (problem) return this.emit('tabs', problem.origin, problem.text, t0, o, false);
    }
    if (o.op === 'open' && this.policy.openTab) {
      const created = this.context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
      if (!(await this.policy.openTab(o.url || 'about:blank'))) return this.emit('tabs', '', '✗ could not open a tab', t0, o, false);
      const p = await created;
      if (p) {
        this.activePage = p;
        await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      }
      this.events = this.events.filter((e) => !e.startsWith('⧉'));
      return o.url ? this.observe() : this.emit('tabs', '', `✓ opened tab`, t0, o);
    }
    if (o.op === 'open') {
      const p = await this.context.newPage();
      this.activePage = p;
      this.events = this.events.filter((e) => !e.startsWith('⧉'));
      if (o.url) return this.navigate(o.url);
      return this.emit('tabs', '', `✓ opened tab ${this.tabIndex(p)}`, t0, o);
    }
    if (o.op === 'switch' || o.op === 'close') {
      const ps = this.pages();
      const p = o.index !== undefined ? ps[o.index] : await this.page();
      if (!p) return this.emit('tabs', '', `✗ no tab ${o.index}`, t0, o, false);
      if (o.op === 'close') {
        await p.close();
        if (this.activePage === p) this.activePage = null;
      } else {
        this.activePage = p;
        await p.bringToFront().catch(() => {});
        return this.observe();
      }
    }
    const active = await this.page();
    const list = this.pages().map((p, i) => `${i}${p === active ? '*' : ' '} ${(p.url() === 'about:blank' ? 'blank' : compactUrl(p.url()))}`);
    return this.emit('tabs', '', list.join('\n'), t0, o);
  }

  // ---------- screenshot ----------
  async screenshot(o: { ref?: number } = {}): Promise<{ text: string; image?: Buffer }> {
    const t0 = Date.now();
    const p = await this.page();
    const origin = originOf(p.url());
    const blocked = await this.siteGate(p);
    if (blocked) return { text: this.emit('blocked', origin, blocked, t0, o, false) };
    const s = await this.snap(p);
    const g = await this.sensitiveGate(s.url, s);
    if (g.block) return { text: this.emit('blocked', origin, g.block, t0, o, false) };
    const a = await this.agent(p);
    const blurred = await a.call<number>('mark', true);
    try {
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (o.ref) {
        const pt = await a.call<PointResult | { error: string }>('point', o.ref);
        if (!('error' in pt)) {
          const vs = p.viewportSize() || { width: 1280, height: 800 };
          clip = { x: Math.max(0, pt.x - 400), y: Math.max(0, pt.y - 250), width: Math.min(800, vs.width), height: Math.min(500, vs.height) };
        }
      }
      const image = await p.screenshot({ type: 'jpeg', quality: 55, scale: 'css', clip });
      const text = this.emit('screenshot', origin, `screenshot ${compactUrl(p.url())}${blurred ? ` (${blurred} sensitive field(s) blurred)` : ''}`, t0, o);
      return { text, image };
    } finally {
      await a.call('mark', false).catch(() => {});
    }
  }

  // ---------- wait ----------
  async wait(o: { text?: string; gone?: string; ms?: number; user?: string; timeoutMs?: number }): Promise<string> {
    const t0 = Date.now();
    const p = await this.page();
    const origin = originOf(p.url());
    if (o.user) {
      const reason = o.user;
      let done = false;
      if (this.policy.waitForUser) done = await this.policy.waitForUser(reason, origin, o.timeoutMs ?? 300_000);
      else {
        process.stderr.write(`\n[whittlebrowser] ACTION NEEDED in the browser window: ${reason}\n`);
        done = await this.pollUntil(async () => {
          const s = await this.snap(p).catch(() => null);
          return !!s && !s.signals.challenge && !s.signals.password && !s.signals.otp;
        }, o.timeoutMs ?? 300_000);
      }
      const head = done ? `✓ user finished: ${reason}` : `✗ timed out waiting for the user: ${reason}`;
      return this.report(p, undefined, [head], p.url(), t0, o, done);
    }
    if (o.text || o.gone) {
      const needle = (o.text || o.gone)!.toLowerCase();
      const want = !!o.text;
      const ok = await this.pollUntil(async () => {
        // An error (page navigating, context destroyed) means "unknown": keep polling instead of calling it gone.
        const has = await p.evaluate((n) => (document.body?.innerText || '').toLowerCase().includes(n), needle).catch(() => null);
        return has !== null && has === want;
      }, o.timeoutMs ?? 15_000);
      return this.report(p, this.baselines.get(p), [ok ? `✓ ${want ? 'appeared' : 'gone'}: "${o.text || o.gone}"` : `✗ timeout waiting for "${o.text || o.gone}"`], p.url(), t0, o, ok);
    }
    await new Promise((r) => setTimeout(r, Math.min(o.ms ?? 1000, 30_000)));
    return this.report(p, this.baselines.get(p), [`✓ waited ${o.ms ?? 1000}ms`], p.url(), t0, o);
  }

  private async pollUntil(fn: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** Tokens sent to the model so far (for the RAM/token meter and benchmarks). */
  tokensUsed(): number {
    return this.trace.reduce((s, t) => s + t.tokens, 0);
  }
}

function flagInjection(text: string): string {
  return text.split('\n').map((l) => (!l.startsWith('⚠') && looksLikeInjection(l) ? '⚠ ' + l : l)).join('\n');
}

function stepLabel(s: Step): string {
  const ref = 'ref' in s && s.ref ? ` [${s.ref}]` : '';
  switch (s.do) {
    case 'type': return `type${ref} ${s.text.startsWith('secret:') ? '‹' + s.text + '›' : '"' + s.text.slice(0, 40) + '"'}`;
    case 'select': return `select${ref} ${s.values.join(', ')}`;
    case 'press': return `press ${s.key}${ref}`;
    case 'scroll': return `scroll${ref}${s.dy ? ' ' + s.dy : ''}`;
    case 'upload': return `upload${ref}`;
    default: return `${s.do}${ref}`;
  }
}

function fitLines(lines: string[], budget: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    const c = estimateTokens(l) + 1;
    if (used + c > budget && out.length) break;
    out.push(l);
    used += c;
  }
  return out;
}
