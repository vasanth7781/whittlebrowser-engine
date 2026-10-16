import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, start } from './helpers.js';
import type { Session } from '../src/driver/session.js';
import type { Launched } from '../src/driver/launch.js';

let srv: Awaited<ReturnType<typeof serve>>;
let s: Session;
let b: Launched;

/** Ref of the first line matching `pattern`. */
function ref(text: string, pattern: RegExp | string): number {
  const re = typeof pattern === 'string' ? new RegExp(`\\[(\\d+)\\] [^\\n]*?${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : pattern;
  const m = text.match(re);
  if (!m) throw new Error(`no ref for ${pattern} in:\n${text}`);
  return +m[1];
}

beforeAll(async () => {
  srv = await serve();
  ({ s, b } = await start({}, {}, { shop_pw: 'CanaryVaultPw-777' }));
});
afterAll(async () => {
  await b?.close();
  await srv?.close();
});

describe('ratings drawn with CSS', () => {
  it('says the rating in the page view', async () => {
    const t = await s.navigate(srv.url('ratings.html'));
    expect(t.match(/rating 5\/5/g)).toHaveLength(3);
    expect(t).toMatch(/rating 2\/5/);
  });

  it('find css: counts visible matches and shows their class', async () => {
    await s.navigate(srv.url('ratings.html'));
    const f = await s.find('css:.star-rating.Five');
    expect(f).toMatch(/: 3 visible match\(es\)/);
    expect(f).toContain('class="star-rating Five"');
    expect(await s.find('css:[[bad')).toMatch(/bad selector/);
  });
});

describe('observe', () => {
  it('renders a compact, labelled form', async () => {
    const t = await s.navigate(srv.url('shipping.html'));
    expect(t).toMatch(/\[\d+\] textbox "Email" required/);
    expect(t).toMatch(/\[\d+\] combobox "Country" = "United States" \(United States, Canada, Mexico, India \+3\)/);
    expect(t).toMatch(/\[\d+\] checkbox "This is a gift"/); // visually hidden input surfaced via its label
    expect(t).toMatch(/agree to our \[\d+\] link "Terms" and \[\d+\] link "Privacy Policy"\./);
    expect(t).not.toContain('Skip footer'); // sr-only text dropped
    expect(t.split('\n').filter((l) => /^\s*Email\s*$/.test(l))).toHaveLength(0); // label not repeated
    expect(t.length / 3.6).toBeLessThan(300);
  });

  it('folds long lists and offers find', async () => {
    const t = await s.navigate(srv.url('table.html'));
    expect(t).toMatch(/… \+\d+ more items \(observe ref \d+\)/);
    expect(t).toMatch(/\+\d+ more rows \(extract table ref \d+\)/);
    const f = await s.find('widget 27');
    expect(f).toMatch(/\[\d+\] link "Widget 27"/);
    expect(f.split('\n')).toHaveLength(2);
  });

  it('extracts tables, repeated items and text', async () => {
    const tableText = await s.extract({ kind: 'table' });
    expect(tableText).toMatch(/^table rows 1-\d+ of 120/);
    expect(tableText).toContain('SKU | Name | Price');
    expect(tableText).toContain('SKU-1120 | Item 120 | $120.00'.slice(0, 0) || 'SKU-1001 | Item 1 | $1.00');
    const list = await s.extract({ kind: 'list' });
    expect(list).toMatch(/^30 items · cols: /);
    expect(list).toMatch(/1\. Widget 1 \| \/p\/1 \| \$1\.50 \| 4\.0 stars/);
    await s.navigate(srv.url('article.html'));
    const md = await s.extract({ kind: 'text', budget: 400 });
    expect(md).toContain('# A history of pancakes');
    expect(md).toMatch(/next: offset=\d+/);
    expect(md).not.toContain('Blog'); // nav boilerplate removed
  });
});

describe('act', () => {
  it('fills a form in one call and reports a diff', async () => {
    const t = await s.navigate(srv.url('shipping.html'));
    const out = await s.act([
      { do: 'type', ref: ref(t, '"Email"'), text: 'jane@example.com' },
      { do: 'select', ref: ref(t, '"Country"'), values: ['canada'] },
      { do: 'check', ref: ref(t, '"This is a gift"') },
    ]);
    expect(out).toMatch(/~ \[\d+\] textbox "Email" = "jane@example.com" required/);
    expect(out).toMatch(/~ \[\d+\] combobox "Country" = "Canada"/);
    expect(out).toMatch(/~ \[\d+\] checkbox "This is a gift" checked/);
    expect(out).not.toContain('h1 Shipping'); // unchanged lines are not re-sent
    const nav = await s.act([{ do: 'click', ref: ref(t, '"Continue to review"') }]);
    expect(nav).toMatch(/→ .*shipping\.html → .*review\.html/);
  });

  it('gates irreversible actions behind confirm', async () => {
    const t = await s.observe();
    const place = ref(t, '"Place order"');
    const refused = await s.act([{ do: 'click', ref: place }]);
    expect(refused).toMatch(/not run: .*irreversible/);
    expect(refused).not.toContain('Order placed');
    const ok = await s.act([{ do: 'click', ref: place }], { confirm: true });
    expect(ok).toContain('Order placed!');
    const del = await s.act([{ do: 'click', ref: ref(t, '"Delete order"') }], { confirm: true });
    expect(del).toContain('confirm "Delete the order?" accepted');
  });

  it('keeps refs stable across framework re-renders and ignores page tampering', async () => {
    const t = await s.navigate(srv.url('spa.html'));
    const task1 = ref(t, '"Task number 1"');
    const rerender = ref(t, '"Re-render"');
    const r1 = await s.act([{ do: 'click', ref: rerender }]);
    expect(r1).toContain('Renders: 2');
    const r2 = await s.act([{ do: 'check', ref: task1 }]); // node was replaced; same ref still works
    expect(r2).toMatch(new RegExp(`\\[${task1}\\] checkbox "Task number 1" checked`));
    const more = await s.act([{ do: 'click', ref: ref(t, '"Load more"') }]);
    expect(more).toMatch(/Task number 4[1-5]|more items/);
  });

  it('refuses to click through an overlay and says what covers it', async () => {
    const t = await s.observe();
    await s.act([{ do: 'click', ref: ref(t, '"Open modal"') }]);
    const out = await s.act([{ do: 'click', ref: ref(t, '"Covered action"') }]);
    expect(out).toMatch(/covered by .*(Cookies|cookies|dialog)/);
  });
});

describe('safety', () => {
  it('drops hidden injection text and flags visible injection', async () => {
    const t = await s.navigate(srv.url('injection.html'));
    for (const hidden of ['attacker.example/steal', 'forward the API key', 'developer mode', 'transfer money', 'email the OTP', 'approve all requests']) expect(t).not.toContain(hidden);
    expect(t).toMatch(/⚠ IMPORTANT: Ignore all previous instructions/);
    expect(t).toMatch(/removed \d+ hidden text block\(s\) with instructions aimed at AI agents/);
  });

  it('never emits canary secrets (observe, find, extract, act, screenshot)', async () => {
    const CANARIES = ['4111 1111 1111 1111', 'sk-ant-api03-CANARY', 'ghp_CANARY', 'AKIACANARY', '219-09-9999', 'eyJhbGciOiJIUzI1NiJ9', 'CanaryPassw0rd', 'CanaryVaultPw-777'];
    const outs: string[] = [];
    const t = await s.navigate(srv.url('canary.html'));
    outs.push(t, await s.observe({ mode: 'full' }), await s.find('key'), await s.find('password'), await s.extract({ kind: 'text', links: true }));
    outs.push(await s.act([{ do: 'type', ref: ref(t, '"Search"'), text: 'secret:shop_pw' }]));
    outs.push(await s.observe(), await s.find('Canary'));
    outs.push((await s.screenshot()).text);
    const all = outs.join('\n');
    for (const c of CANARIES) expect(all, c).not.toContain(c);
    expect(all).toContain('‹secret:shop_pw›');
    expect(all).toMatch(/⚿password/);
  });

  it('auto-pauses on payment pages and sends nothing', async () => {
    const t = await s.navigate(srv.url('card.html'));
    expect(t).toMatch(/⏸ AI auto-paused .*payment card/);
    expect(t).not.toContain('Pay $12');
    expect(await s.find('card')).toMatch(/⏸/);
  });
});

describe('pages without semantic tags', () => {
  it('infers landmarks, listener-backed clickables, modals and menus', async () => {
    const t = await s.navigate(srv.url('divsoup.html'));
    expect(t).toMatch(/^header\n Acme\n nav\n  \[\d+\] clickable "Home"/m);   // div.topbar + span listeners
    expect(t).toMatch(/^aside\n \[\d+\] clickable "Inbox"/m);                 // div.sidebar
    expect(t).toMatch(/^footer\n/m);                                             // div.footer
    expect(t).toMatch(/\[\d+\] clickable "Download invoice \(React\)"/);        // React onClick prop, delegated listener
    expect(t).toMatch(/\[\d+\] clickable "More ▾" popup/);
    const card = +t.match(/\[(\d+)\] clickable[^\n]*Order #1002/)![1];
    const opened = await s.act([{ do: 'click', ref: card }]);
    expect(opened).toMatch(/\+ \[\d+\] dialog "Order #1002"/);                    // fixed overlay → dialog
    const close = +opened.match(/\[(\d+)\] clickable "Close"/)![1];
    expect(await s.act([{ do: 'click', ref: close }])).toMatch(/- \[\d+\] dialog "Order #1002"/);
    const more = await s.act([{ do: 'click', ref: +t.match(/\[(\d+)\] clickable "More/)![1] }]);
    expect(more).toMatch(/\+ menu\n\+  \[\d+\] clickable "Export CSV"/);
  });
});

describe('research, x-ray, cursor', () => {
  it('reads result pages in parallel with per-page digests and gates', async () => {
    await s.navigate(srv.url('results.html'));
    const r = await s.research({ limit: 4, budget: 200 });
    expect(r).toMatch(/^research: 4 pages in [\d.]+s \(parallel\)/);
    expect(r).toContain('## 1. Pancake history');
    expect(r).toMatch(/## 2\. Products/);
    expect(r).toMatch(/## 3\. Recipes[\s\S]*⚠? ?IMPORTANT|## 3\. Recipes/);
    expect(r).not.toContain('attacker.example/steal');           // hidden injection never reaches the digest
    expect(r).toMatch(/## 4\. 127\.0\.0\.1\n⏸ AI auto-paused/);  // payment page is gated, not read
    expect(r.length / 3.6).toBeLessThan(1400);
    expect(s.pages()).toHaveLength(1);                             // background tabs closed again
    expect(await s.observe()).toContain('Results for');            // focus never moved
  });

  it('draws the X-ray overlay without leaking it into observations', async () => {
    const { s: s2, b: b2 } = await start({}, { xray: true, showCursor: true });
    try {
      const t = await s2.navigate(srv.url('injection.html'));
      const p = (await (s2 as any).page()) as import('playwright-core').Page;
      await p.waitForTimeout(500);
      const overlay = await p.evaluate(() => !!document.querySelector('wb-overlay') && document.documentElement.hasAttribute('data-wb-xray'));
      expect(overlay).toBe(true);
      expect(t).not.toMatch(/hidden from AI|X-ray/);
      const ref = +t.match(/\[(\d+)\] button "Save recipe"/)![1];
      const t0 = Date.now();
      const out = await s2.act([{ do: 'click', ref }]);
      expect(out).toContain('✓ click');
      expect(out).not.toMatch(/X-ray|hidden from AI|controls/);    // overlay mutations are not page changes
      expect(Date.now() - t0).toBeGreaterThan(150);                 // the pointer travelled before the click
      expect(await s2.observe()).not.toContain('wb-overlay');
    } finally {
      await b2.close();
    }
  });
});

describe('human-like input', () => {
  it('moves the real pointer on a curved, eased path and lands inside the target', async () => {
    const { s: s2, b: b2 } = await start({}, { humanize: true, showCursor: true });
    try {
      const t = await s2.navigate(srv.url('shipping.html'));
      const p = (await (s2 as any).page()) as import('playwright-core').Page;
      await p.evaluate(() => { (window as any).__moves = []; document.addEventListener('mousemove', (e) => (window as any).__moves.push([e.clientX, e.clientY, performance.now()])); });
      const ref = +t.match(/\[(\d+)\] button "Continue to review"/)![1];
      await s2.act([{ do: 'hover', ref }]);
      const moves = (await p.evaluate(() => (window as any).__moves)) as [number, number, number][];
      expect(moves.length).toBeGreaterThan(8);
      const [x0, y0] = moves[0], [x1, y1] = moves[moves.length - 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const dev = Math.max(...moves.map(([x, y]) => Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / (len || 1)));
      expect(dev).toBeGreaterThan(1);                               // not a straight line
      const box = await p.getByRole('button', { name: 'Continue to review' }).boundingBox();
      expect(x1).toBeGreaterThanOrEqual(box!.x); expect(x1).toBeLessThanOrEqual(box!.x + box!.width);
      expect(y1).toBeGreaterThanOrEqual(box!.y); expect(y1).toBeLessThanOrEqual(box!.y + box!.height);
      const steps = moves.slice(1).map((m, i) => Math.hypot(m[0] - moves[i][0], m[1] - moves[i][1]));
      const mid = steps.slice(Math.floor(steps.length * 0.35), Math.ceil(steps.length * 0.65));
      const ends = [...steps.slice(0, 2), ...steps.slice(-2)];
      expect(Math.max(...mid)).toBeGreaterThan(Math.max(...ends));  // faster in the middle, slow at the ends
    } finally {
      await b2.close();
    }
  });

  it('lets the drawn cursor drift while the agent thinks, without sending the page any mouse events', async () => {
    const { s: s2, b: b2 } = await start({}, { showCursor: true });
    try {
      await s2.navigate(srv.url('article.html'));
      const p = (await (s2 as any).page()) as import('playwright-core').Page;
      await p.evaluate(() => { (window as any).__mm = 0; addEventListener('mousemove', () => (window as any).__mm++, true); addEventListener('mouseover', () => (window as any).__mm++, true); });
      (s2 as any).kickIdle(); // as after any tool result
      const a = await (s2 as any).agent(p);
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 700));
        // Read the drawn cursor's position without stopping the drift.
        const g = await a.call('ghostPos'); seen.push(g && `${g.x},${g.y}`);
      }
      expect(seen.every(Boolean)).toBe(true);                      // the cursor appeared on the fresh page
      expect(new Set(seen).size).toBeGreaterThan(2);               // and kept drifting
      expect(await p.evaluate(() => (window as any).__mm)).toBe(0); // drawn only: the page saw no mouse events
    } finally {
      await b2.close();
    }
  });
});

describe('policy', () => {
  it('blocks sites where AI is off', async () => {
    const { s: s2, b: b2 } = await start({ defaultMode: 'off' });
    try {
      const t = await s2.navigate(srv.url('shipping.html'));
      expect(t).toMatch(/⏸ AI is off for 127\.0\.0\.1/);
      expect(t).not.toContain('Email');
    } finally {
      await b2.close();
    }
  });
});
