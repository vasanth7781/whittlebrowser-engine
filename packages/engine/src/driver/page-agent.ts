/**
 * Bridge to the in-page agent for one tab. The agent runs in a CDP isolated world (worldName "__wb"),
 * created lazily per document, so page JavaScript cannot observe or tamper with it.
 */
import type { CDPSession, Page } from 'playwright-core';
import { PAGE_AGENT_SOURCE } from '../page/agent.js';

export class PageAgent {
  private cdp: CDPSession | null = null;
  private ctxId: number | null = null;
  private creating: Promise<number> | null = null;
  inflight = 0;
  private lastNet = Date.now();

  constructor(readonly page: Page, private refSeed: () => number, private initExtra: () => Record<string, unknown> = () => ({})) {
    const track = (d: number) => (req: { resourceType(): string }) => {
      const t = req.resourceType();
      if (t === 'websocket' || t === 'eventsource' || t === 'media' || t === 'other' || t === 'ping') return;
      this.inflight = Math.max(0, this.inflight + d);
      this.lastNet = Date.now();
    };
    page.on('request', track(1));
    page.on('requestfinished', track(-1));
    page.on('requestfailed', track(-1));
  }

  private async session(): Promise<CDPSession> {
    if (this.cdp) return this.cdp;
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Page.enable');
    this.cdp.on('Page.frameNavigated', (e: { frame: { parentId?: string } }) => {
      if (!e.frame.parentId) this.ctxId = null;
    });
    return this.cdp;
  }

  private async context(): Promise<number> {
    if (this.ctxId !== null) return this.ctxId;
    if (this.creating) return this.creating;
    this.creating = (async () => {
      const cdp = await this.session();
      const { frameTree } = (await cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
      const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id,
        worldName: '__wb',
        grantUniveralAccess: false,
      })) as { executionContextId: number };
      await this.raw(executionContextId, PAGE_AGENT_SOURCE);
      await this.raw(executionContextId, `__wb.init(${JSON.stringify({ nextRef: this.refSeed(), ...this.initExtra() })})`);
      this.ctxId = executionContextId;
      this.probedAt = -1; // new document: handlers must be probed again
      return executionContextId;
    })();
    try {
      return await this.creating;
    } finally {
      this.creating = null;
    }
  }

  private async raw(contextId: number, expression: string): Promise<unknown> {
    const cdp = await this.session();
    const r = (await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })) as {
      result: { value?: unknown };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  /** Call __wb.<fn>(...args) in the isolated world. Re-creates the world once if the document changed. */
  async call<T>(fn: string, ...args: unknown[]): Promise<T> {
    const expr = `__wb.${fn}(${args.map((a) => JSON.stringify(a ?? null)).join(',')})`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const id = await this.context();
        return (await this.raw(id, expr)) as T;
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (/Cannot find context|Execution context was destroyed|__wb is not defined|Inspected target navigated|uniqueContextId|context with specified id/i.test(msg) && attempt < 2) {
          this.ctxId = null;
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          continue;
        }
        throw e;
      }
    }
    throw new Error('unreachable');
  }

  private probedAt = -1;

  /**
   * Find elements with real click handlers that carry no semantic markup (div/span/li "buttons").
   * Runs in the page's main world, where framework state lives: getEventListeners (DevTools command-line
   * API) catches addEventListener/Vue/Angular/Svelte handlers; __reactProps$ catches React's onClick.
   * Only re-runs after DOM changes. The page could lie here, but the worst case is a missing hint.
   */
  async probeClicks(): Promise<void> {
    const v = await this.call<number>('mutVersion').catch(() => -2);
    if (v === this.probedAt) return;
    const cdp = await this.session();
    const r = (await cdp.send('Runtime.evaluate', { expression: CLICK_PROBE, includeCommandLineAPI: true, returnByValue: true, silent: true }).catch(() => null)) as
      | { result: { value?: { l: number[]; r: number[] } } }
      | null;
    const val = r?.result.value;
    if (val) await this.call('markClick', val.l, val.r).catch(() => {});
    this.probedAt = v;
  }

  /** Make sure refs allocated in this tab continue from the session-wide counter. */
  async syncRefs(next: number): Promise<number> {
    return this.call<number>('init', { nextRef: next });
  }

  /** Wait until the network has been idle for quietMs (ignoring long-lived streams), up to timeoutMs. */
  async networkIdle(quietMs = 300, timeoutMs = 3000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.inflight === 0 && Date.now() - this.lastNet >= quietMs) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    this.inflight = 0; // reset leaked counters (aborted requests without events)
    return false;
  }

  async objectIdFor(ref: number): Promise<string | null> {
    const id = await this.context();
    const cdp = await this.session();
    const r = (await cdp.send('Runtime.evaluate', {
      expression: `(() => { const el = __wb.resolveEl(${ref}); return el; })()`,
      contextId: id,
    })) as { result: { objectId?: string } };
    return r.result.objectId || null;
  }

  async setFiles(ref: number, files: string[]): Promise<void> {
    const objectId = await this.objectIdFor(ref);
    if (!objectId) throw new Error('gone');
    const cdp = await this.session();
    await cdp.send('DOM.setFileInputFiles', { files, objectId });
  }

  dispose() {
    this.cdp?.detach().catch(() => {});
    this.cdp = null;
    this.ctxId = null;
  }
}

const CLICK_PROBE = `(() => {
  const all = document.querySelectorAll('*'), l = [], r = [];
  const gel = typeof getEventListeners === 'function' ? getEventListeners : null;
  const skip = /^(a|button|input|select|textarea|label|option|summary|html|body|head|script|style|link|meta|wb-overlay)$/;
  for (let i = 0; i < all.length && i < 25000; i++) {
    const el = all[i];
    if (skip.test(el.localName)) continue;
    let k = null;
    for (const key in el) { if (key.charCodeAt(0) === 95 && key.startsWith('__reactProps$')) { k = key; break; } }
    if (k) { const p = el[k]; if (p && (p.onClick || p.onMouseDown || p.onPointerDown || p.onMouseUp)) { r.push(i); continue; } }
    if (gel) { const e = gel(el); if (e && (e.click || e.mousedown || e.pointerdown || e.mouseup || e.pointerup)) l.push(i); }
  }
  return { l, r };
})()`;
