/**
 * The in-page agent. It is serialised with Function.prototype.toString() and evaluated inside a CDP
 * isolated world, so page scripts cannot see or tamper with it (no monkey-patched DOM APIs, no peeking
 * at refs). It must stay fully self-contained: no imports, no references to module scope.
 *
 * It exposes globalThis.__wb with: init, snapshot, find, query, point, focusForTyping, selectOption, scroll,
 * waitQuiet, describe, table, list, read, signals, mark.
 */
import type { RawNode, RawSnapshot, FindHit, PointResult, Describe, PageSignals } from '../core/types.js';

export function installAgent(): void {
  const G = globalThis as any;
  if (G.__wb) return;

  // ---------- state that survives between calls (lives as long as the document) ----------
  const S = {
    next: 1,
    el2ref: new WeakMap<Element, number>(),
    ref2el: new Map<number, WeakRef<Element>>(),
    ref2fp: new Map<number, string>(),
    fp2ref: new Map<string, number>(),
    /** Elements with real click handlers, found by the main-world probe (addEventListener or React props). */
    click: new WeakSet<Element>(),
    /** Bumped on DOM changes so Node only re-probes for handlers when something changed. */
    mut: 0,
  };
  let MAIN_GUESS: Element | null = null;

  // ---------- per-call caches ----------
  let CS = new Map<Element, CSSStyleDeclaration>();
  let VC = new Map<Element, number>();
  let VW = 0;
  let VH = 0;

  const MAX_NODES = 6000;
  const NAME_MAX = 100;

  const IA_SEL =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true],' +
    '[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=menuitemcheckbox],' +
    '[role=menuitemradio],[role=option],[role=textbox],[role=combobox],[role=searchbox],[role=slider],[role=spinbutton],' +
    '[role=treeitem],[tabindex]:not([tabindex="-1"])';

  const INTERACTIVE = new Set([
    'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'combobox',
    'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'clickable', 'file',
  ]);
  // Interactive roles whose children are never interesting on their own.
  const LEAF_INTERACTIVE = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'file', 'checkbox', 'radio', 'switch']);
  const CONTAINERS = new Set([
    'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search', 'form', 'region', 'dialog', 'alertdialog',
    'list', 'table', 'grid', 'treegrid', 'tablist', 'menu', 'menubar', 'tree', 'toolbar', 'radiogroup', 'group', 'tabpanel',
    'article', 'alert', 'status', 'row', 'rowgroup', 'listitem', 'cell', 'gridcell', 'columnheader', 'rowheader', 'figure',
  ]);
  const NAME_FROM_CONTENT = new Set([
    'button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'cell', 'gridcell',
    'columnheader', 'rowheader', 'treeitem', 'checkbox', 'radio', 'switch', 'clickable', 'tooltip', 'row',
  ]);
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base', 'datalist', 'param', 'source', 'track', 'wb-overlay']);
  const OVERLAY_TAG = 'wb-overlay';
  let INJ: RegExp[] = [];
  /** Mutations caused by our own overlay or data-wb-* flags (ignored by waitQuiet and X-ray refresh). */
  const ours = (r: MutationRecord) =>
    (r.target as Element).localName === OVERLAY_TAG ||
    (r.type === 'attributes' && (r.attributeName || '').startsWith('data-wb-')) ||
    (r.type === 'childList' && [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every((n) => (n as Element).localName === OVERLAY_TAG));
  let isEngine = false;
  /** Elements whose text was withheld from the model (for X-ray): hidden = deceptive styling, inj = looks like injection. */
  let MARKS: { el: Element; kind: 'hidden' | 'inj' }[] = [];
  const markEl = (el: unknown, kind: 'hidden' | 'inj') => {
    if (MARKS.length < 60 && el && (el as Element).nodeType === 1 && !MARKS.some((m) => m.el === el)) MARKS.push({ el: el as Element, kind });
  };

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const clip = (s: string, n = NAME_MAX) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function style(el: Element): CSSStyleDeclaration {
    let cs = CS.get(el);
    if (!cs) {
      cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      CS.set(el, cs);
    }
    return cs;
  }

  // ---------- visibility ----------
  // 0 visible · 1 not rendered (prune) · 2 visually hidden on purpose (sr-only, off-document) · 3 deceptive (opacity 0, tiny, low contrast)
  function verdict(el: Element): number {
    let v = VC.get(el);
    if (v !== undefined) return v;
    const cs = style(el);
    if (cs.display === 'none' || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert') ||
        cs.visibility === 'hidden' || cs.visibility === 'collapse' || (cs as any).contentVisibility === 'hidden') {
      v = 1;
    } else if (cs.display !== 'contents') {
      const r = el.getBoundingClientRect();
      const win = el.ownerDocument.defaultView || window;
      if ((r.width <= 1 && r.height <= 1 && (cs.overflow !== 'visible' || cs.position === 'absolute')) ||
          cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(cs.clipPath || '')) {
        v = 2;
      } else if (r.right + win.scrollX < 0 || r.bottom + win.scrollY < 0) {
        v = 2;
      } else if (parseFloat(cs.opacity) === 0) {
        v = 3;
      } else if (hasOwnText(el) && (parseFloat(cs.fontSize) < 4 || lowContrast(el, cs))) {
        v = 3;
      }
    }
    v ??= 0;
    VC.set(el, v);
    return v;
  }

  function hasOwnText(el: Element): boolean {
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && (n as Text).data.trim()) return true;
    return false;
  }

  function parseColor(c: string): [number, number, number, number] | null {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function lum(c: [number, number, number, number]): number {
    const f = (x: number) => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function lowContrast(el: Element, cs: CSSStyleDeclaration): boolean {
    const fg = parseColor(cs.color);
    if (!fg) return false;
    if (fg[3] < 0.1) return true;
    let bg: [number, number, number, number] | null = null;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = style(a);
      if (s.backgroundImage && s.backgroundImage !== 'none') return false; // cannot know what is behind
      const c = parseColor(s.backgroundColor);
      if (c && c[3] > 0.9) { bg = c; break; }
    }
    bg ??= [255, 255, 255, 1];
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return ratio < 1.12 && !(cs.textShadow && cs.textShadow !== 'none');
  }

  // ---------- roles, names, states ----------
  function roleOf(el: Element, cs: CSSStyleDeclaration): string {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit && explicit !== 'presentation' && explicit !== 'none' && explicit !== 'generic') return explicit;
    const tag = el.localName;
    switch (tag) {
      case 'a': case 'area': return el.hasAttribute('href') ? 'link' : '';
      case 'button': return 'button';
      case 'input': {
        const t = (el as HTMLInputElement).type;
        if (t === 'hidden') return '';
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
        if (t === 'checkbox') return el.hasAttribute('switch') ? 'switch' : 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'number') return 'spinbutton';
        if (t === 'file') return 'file';
        if (t === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      }
      case 'select': return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox';
      case 'textarea': return 'textbox';
      case 'option': return 'option';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'header': return el.closest('article,aside,main,nav,section') ? '' : 'banner';
      case 'footer': return el.closest('article,aside,main,nav,section') ? '' : 'contentinfo';
      case 'aside': return 'complementary';
      case 'form': return 'form';
      case 'search': return 'search';
      case 'section': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
      case 'dialog': return 'dialog';
      case 'ul': case 'ol': case 'menu': return 'list';
      case 'li': return 'listitem';
      case 'table': return 'table';
      case 'thead': case 'tbody': case 'tfoot': return 'rowgroup';
      case 'tr': return 'row';
      case 'th': return el.closest('thead') || !el.parentElement?.querySelector('td') ? 'columnheader' : 'rowheader';
      case 'td': return 'cell';
      case 'img': return (el as HTMLImageElement).alt === '' && el.hasAttribute('alt') ? '' : 'img';
      case 'fieldset': return 'group';
      case 'details': return 'group';
      case 'summary': return 'button';
      case 'article': return 'article';
      case 'iframe': return 'iframe';
      case 'progress': return 'progressbar';
      case 'meter': return 'meter';
      case 'output': return 'status';
      case 'figure': return 'figure';
    }
    if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return 'textbox';
    const inferred = inferRole(el, cs);
    if (inferred) return inferred;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && +ti >= 0) return 'clickable';
    if (S.click.has(el)) return 'clickable';
    if (el.hasAttribute('onclick') || (cs.cursor === 'pointer' && el.parentElement && style(el.parentElement).cursor !== 'pointer')) {
      if (!el.querySelector(IA_SEL)) return 'clickable';
    }
    return '';
  }

  // ---------- role inference for markup that skips semantic tags ----------
  // div-based headers, navs, sidebars, footers, modals, menus, tabs, toasts: class/id words + position.
  const TOKENS = new WeakMap<Element, Set<string>>();
  function tokens(el: Element): Set<string> {
    let t = TOKENS.get(el);
    if (!t) {
      const raw = ((typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : el.getAttribute('class') || '') + ' ' + el.id)
        .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      t = new Set(raw.split(/[^a-z0-9]+/).filter(Boolean));
      const joined = raw.replace(/[^a-z0-9]+/g, '');
      for (const w of ['topbar', 'navbar', 'sidebar', 'sidenav', 'appbar', 'masthead', 'footer', 'header', 'dropdown', 'modal', 'dialog', 'popover', 'tablist', 'snackbar', 'breadcrumb']) if (joined.includes(w)) t.add(w);
      TOKENS.set(el, t);
    }
    return t;
  }
  const any = (t: Set<string>, ...w: string[]) => w.some((x) => t.has(x));
  function inferRole(el: Element, cs: CSSStyleDeclaration): string {
    const tag = el.localName;
    if (tag !== 'div' && tag !== 'section' && tag !== 'span' && tag !== 'ul' && tag !== 'ol' && tag !== 'li' && !tag.includes('-')) return '';
    if (el === MAIN_GUESS) return 'main';
    if (el.getAttribute('aria-modal') === 'true') return 'dialog';
    const t = tokens(el);
    const r = () => el.getBoundingClientRect();
    const hasControls = () => !!el.querySelector(IA_SEL) || hasClickDesc(el);
    const z = parseInt(cs.zIndex) || 0;
    // Overlays: a fixed layer above the page with something to read or press.
    if ((any(t, 'modal', 'dialog', 'lightbox', 'drawer') && !any(t, 'trigger', 'toggle', 'btn', 'button', 'open')) ||
        (cs.position === 'fixed' && z >= 10 && (() => { const b = r(); return b.width * b.height >= 0.12 * VW * VH && b.height > 120; })())) {
      if (hasControls() && collapse(el.textContent || '').length > 0) return 'dialog';
    }
    if (any(t, 'dropdown', 'popover', 'menu') && !any(t, 'trigger', 'toggle', 'btn', 'button', 'item', 'icon', 'link', 'links') &&
        (cs.position === 'absolute' || cs.position === 'fixed') && el.children.length >= 2) return 'menu';
    if (any(t, 'tablist') || (t.has('tabs') && el.children.length >= 2 && !any(t, 'content', 'panel', 'body'))) return 'tablist';
    if (any(t, 'toast', 'snackbar', 'notification', 'flash') && collapse(el.textContent || '')) return 'status';
    if (any(t, 'search', 'searchbar') && el.querySelector('input')) return 'search';
    if (any(t, 'footer') && !any(t, 'card', 'modal', 'item')) {
      const b = r();
      if (b.top + scrollY > document.documentElement.scrollHeight * 0.5 || !el.nextElementSibling) return 'contentinfo';
    }
    if (any(t, 'topbar', 'header', 'masthead', 'appbar', 'navbar') && !any(t, 'card', 'modal', 'dialog', 'section', 'table', 'column', 'cell', 'item', 'title')) {
      const b = r();
      if (b.top + scrollY < 140 && b.width >= VW * 0.6 && !el.closest('main,article,[role=main]')) return t.has('navbar') && !t.has('header') ? 'navigation' : 'banner';
    }
    if (any(t, 'sidebar', 'sidenav', 'aside') && !any(t, 'item', 'toggle', 'btn')) return any(t, 'nav', 'sidenav') ? 'navigation' : 'complementary';
    if (any(t, 'nav', 'navigation', 'breadcrumb', 'breadcrumbs') && !any(t, 'item', 'toggle', 'btn', 'button', 'icon') && hasControls()) return 'navigation';
    return '';
  }
  function hasClickDesc(el: Element): boolean {
    for (const d of Array.from(el.querySelectorAll('div,span,li,img,svg,p')).slice(0, 200)) if (S.click.has(d)) return true;
    return false;
  }
  // No <main>? Pick the deepest block holding most of the page's non-link text.
  function guessMain(): Element | null {
    if (document.querySelector('main,[role=main]')) return null;
    const score = (e: Element) => {
      const txt = (e.textContent || '').length;
      let link = 0;
      for (const a of Array.from(e.querySelectorAll('a'))) link += (a.textContent || '').length;
      return txt - link * 1.5;
    };
    let best: Element | null = null, bestScore = 0;
    for (const e of Array.from(document.body?.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *') || [])) {
      if (!/^(div|section)$/.test(e.localName)) continue;
      const sc = score(e);
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    if (!best || bestScore < 200) return null;
    for (let moved = true; moved;) {
      moved = false;
      for (const c of Array.from(best!.children)) if (/^(div|section)$/.test(c.localName) && score(c) >= bestScore * 0.8) { best = c; moved = true; break; }
    }
    const b = best!.getBoundingClientRect();
    return b.width >= innerWidth * 0.35 ? best : null;
  }

  function textOf(root: Node, budget = 220, includeHidden = false): string {
    let out = '';
    const visit = (n: Node) => {
      if (out.length > budget) return;
      if (n.nodeType === 3) { out += (n as Text).data; return; }
      if (n.nodeType !== 1) return;
      const el = n as Element;
      const tag = el.localName;
      if (SKIP_TAGS.has(tag)) return;
      if (!includeHidden && el !== root) {
        const v = verdict(el);
        if (v === 1 || v === 3) return;
      }
      if (tag === 'img') { out += ' ' + ((el as HTMLImageElement).alt || '') + ' '; return; }
      if (tag === 'svg') { out += ' ' + (el.getAttribute('aria-label') || el.querySelector('title')?.textContent || '') + ' '; return; }
      if (tag === 'input') { const i = el as HTMLInputElement; if (i.type === 'button' || i.type === 'submit') out += ' ' + i.value + ' '; return; }
      if (tag === 'select' || tag === 'textarea') return;
      if (tag === 'br') { out += ' '; return; }
      const lab = el.getAttribute('aria-label');
      if (lab && el !== root) { out += ' ' + lab + ' '; return; }
      const block = !style(el).display.startsWith('inline');
      if (block) out += ' ';
      const kids = (el as HTMLElement).shadowRoot ? (el as HTMLElement).shadowRoot!.childNodes : el.childNodes;
      for (const k of Array.from(kids)) visit(k);
      if (block) out += ' ';
    };
    visit(root);
    return collapse(out);
  }

  function accName(el: Element, role: string): string {
    const doc = el.ownerDocument;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? textOf(x, 220, true) : ''; }).join(' ');
      if (collapse(t)) return clip(collapse(t));
    }
    const al = el.getAttribute('aria-label');
    if (al && collapse(al)) return clip(collapse(al));
    const tag = el.localName;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const i = el as HTMLInputElement;
      if (i.type === 'button' || i.type === 'submit' || i.type === 'reset') return clip(i.value || (i.type === 'submit' ? 'Submit' : i.type === 'reset' ? 'Reset' : ''));
      if (i.type === 'image') return clip(i.alt || i.value || 'Submit');
      const labels = i.labels ? Array.from(i.labels).map((l) => textOfLabel(l, el)).join(' ') : '';
      if (collapse(labels)) return clip(collapse(labels));
      const ph = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
      if (ph) return clip(collapse(ph));
      const t = el.getAttribute('title');
      if (t) return clip(collapse(t));
      return '';
    }
    if (tag === 'img' || tag === 'area') return clip(collapse((el as HTMLImageElement).alt || el.getAttribute('title') || ''));
    if (tag === 'fieldset') { const l = el.querySelector(':scope > legend'); if (l) return clip(textOf(l)); }
    if (tag === 'table') { const c = (el as HTMLTableElement).caption; if (c) return clip(textOf(c)); }
    if (tag === 'figure') { const c = el.querySelector(':scope > figcaption'); if (c) return clip(textOf(c)); }
    if (tag === 'details') { const s = el.querySelector(':scope > summary'); if (s) return clip(textOf(s)); }
    if (tag === 'iframe') return clip(el.getAttribute('title') || el.getAttribute('name') || '');
    if (role === 'dialog' || role === 'alertdialog') {
      const h = el.querySelector('h1,h2,h3,h4,[class*=title i],[class*=heading i],[class*=header i]');
      if (h) { const ht = textOf(h, 80); if (ht) return clip(ht, 60); }
    }
    if (NAME_FROM_CONTENT.has(role)) {
      const t = textOf(el);
      if (t) return clip(t, role === 'clickable' || role === 'row' ? 80 : NAME_MAX);
    }
    const t = el.getAttribute('title');
    if (t) return clip(collapse(t));
    return INTERACTIVE.has(role) ? hintName(el) : '';
  }

  // Icon-only controls: borrow a descendant title/alt, an icon class word, or the link target.
  const ICON_WORDS = /\b(close|menu|hamburger|search|cart|user|account|profile|settings|edit|delete|trash|remove|share|like|upvote|downvote|vote|next|prev|previous|back|forward|play|pause|more|expand|collapse|download|upload|copy|filter|sort|home|help|notifications?|bell|star|heart|bookmark|send|attach|refresh|reload|add|plus|minus|info|logout|login)\b/i;
  function hintName(el: Element): string {
    const d = el.querySelector('[title],[aria-label],img[alt]:not([alt=""])');
    const dt = d && (d.getAttribute('aria-label') || d.getAttribute('title') || d.getAttribute('alt'));
    if (dt) return clip(collapse(dt));
    const cls = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 4)].map((x) => (typeof x.className === 'string' ? x.className : x.getAttribute('class') || '') + ' ' + (x.getAttribute('data-icon') || '') + ' ' + (x.getAttribute('data-testid') || '')).join(' ').replace(/[-_]/g, ' ');
    const m = cls.match(ICON_WORDS);
    if (m) return m[1].toLowerCase();
    const href = el.getAttribute('href');
    if (href && !href.startsWith('javascript:') && href !== '#') {
      const path = href.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].split('/').filter(Boolean).pop();
      if (path) return clip(path, 30);
    }
    return '';
  }

  // Label text without the control's own value (e.g. <label>Qty <input value=3></label>).
  function textOfLabel(l: Element, control: Element): string {
    const clone = l.cloneNode(true) as Element;
    clone.querySelectorAll('input,select,textarea').forEach((x) => x.remove());
    void control;
    return collapse(clone.textContent || '');
  }

  const SENS_RE: [string, RegExp][] = [
    ['card', /card.?num|cc.?num|credit.?card|\bcvv|\bcvc|\bcsc\b|security.?code|card.?code|expir/i],
    ['otp', /\botp\b|one.?time|2fa|totp|verification.?code|auth.?code|passcode|mfa/i],
    ['id', /\bssn\b|social.?security|aadhaa?r|\bpan\b.?(no|num)|tax.?id|passport/i],
    ['secret', /api.?key|secret|access.?token|private.?key|client.?secret/i],
    ['pin', /\bpin\b/i],
  ];
  function sensitiveKind(el: Element): string {
    const tag = el.localName;
    if (tag !== 'input' && tag !== 'textarea' && !(el as HTMLElement).isContentEditable) return '';
    const i = el as HTMLInputElement;
    if (i.type === 'password') return 'password';
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (/cc-(number|csc|exp)/.test(ac)) return 'card';
    if (ac.includes('one-time-code')) return 'otp';
    if (ac.includes('current-password') || ac.includes('new-password')) return 'password';
    const hay = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder'), i.labels?.[0]?.textContent]
      .filter(Boolean).join(' ');
    for (const [k, re] of SENS_RE) if (re.test(hay)) return k;
    return '';
  }

  function statesOf(el: Element, role: string): string {
    const s: string[] = [];
    const a = (n: string) => el.getAttribute(n);
    const h = el as HTMLInputElement;
    if (h.disabled || a('aria-disabled') === 'true') s.push('disabled');
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      const ac = a('aria-checked');
      if (ac === 'mixed' || h.indeterminate) s.push('mixed');
      else if (h.checked || ac === 'true') s.push('checked');
    }
    const hp = a('aria-haspopup');
    if (hp && hp !== 'false') s.push('popup');
    const ex = a('aria-expanded');
    if (ex === 'true') s.push('expanded');
    else if (ex === 'false') s.push('collapsed');
    if (el.localName === 'summary') s.push((el.parentElement as HTMLDetailsElement)?.open ? 'expanded' : 'collapsed');
    if (a('aria-selected') === 'true' || (role === 'option' && (el as HTMLOptionElement).selected)) s.push('selected');
    const cur = a('aria-current');
    if (cur && cur !== 'false') s.push('current');
    if (a('aria-pressed') === 'true') s.push('pressed');
    if (h.required || a('aria-required') === 'true') s.push('required');
    if (a('aria-invalid') === 'true' || ((el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select') &&
        (el as HTMLInputElement).matches(':user-invalid'))) s.push('invalid');
    if (h.readOnly || a('aria-readonly') === 'true') s.push('readonly');
    return s.join(' ');
  }

  function deepActive(): Element | null {
    let a: Element | null = document.activeElement;
    while (a) {
      if ((a as HTMLElement).shadowRoot?.activeElement) a = (a as HTMLElement).shadowRoot!.activeElement;
      else if (a.localName === 'iframe') {
        try { const d = (a as HTMLIFrameElement).contentDocument; if (!d || !d.activeElement || d.activeElement === d.body) break; a = d.activeElement; } catch { break; }
      } else break;
    }
    return a;
  }

  function valueOf(el: Element, role: string, sens: string): string | undefined {
    const tag = el.localName;
    let v: string | undefined;
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      v = Array.from(sel.selectedOptions).map((o) => collapse(o.text)).join(', ');
    } else if (tag === 'input' || tag === 'textarea') {
      const i = el as HTMLInputElement;
      if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'button' || role === 'file') {
        if (role === 'file') v = i.files && i.files.length ? Array.from(i.files).map((f) => f.name).join(', ') : '';
        else return undefined;
      } else v = i.value;
    } else if ((el as HTMLElement).isContentEditable) {
      v = collapse((el as HTMLElement).innerText || '');
    } else if (role === 'slider' || role === 'spinbutton' || role === 'progressbar' || role === 'meter') {
      v = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow') || (el as HTMLInputElement).value || '';
    } else if (role === 'combobox' || role === 'textbox' || role === 'searchbox') {
      v = el.getAttribute('aria-valuetext') || '';
    }
    if (v === undefined) return undefined;
    if (sens) return v ? '•••' : '';
    return clip(v, 120);
  }

  // ---------- refs ----------
  let fpCounts = new Map<string, number>();
  let newFp2ref = new Map<string, number>();

  function refFor(el: Element, role: string, name: string): number {
    const base = role + '|' + name.slice(0, 40);
    const k = (fpCounts.get(base) || 0) + 1;
    fpCounts.set(base, k);
    const fp = base + '|' + k;
    let r = S.el2ref.get(el);
    if (r === undefined) {
      const prev = S.fp2ref.get(fp);
      const prevEl = prev !== undefined ? S.ref2el.get(prev)?.deref() : undefined;
      // Reuse the ref when a framework re-rendered the same control (old node detached, same fingerprint).
      if (prev !== undefined && (!prevEl || !prevEl.isConnected)) r = prev;
      else r = S.next++;
      S.el2ref.set(el, r);
      S.ref2el.set(r, new WeakRef(el));
    }
    S.ref2fp.set(r, fp);
    newFp2ref.set(fp, r);
    return r;
  }

  function resolve(ref: number): Element | null {
    const el = S.ref2el.get(ref)?.deref();
    if (el && el.isConnected) return el;
    return null;
  }

  // ---------- the walk ----------
  interface Ctx { hide: number; ox: number; oy: number; count: number; stats: { hiddenText: number; deceptiveText: number; truncated: boolean; samples: string[] }; signals: PageSignals; emitted: Set<Element> }

  function offscreen(el: Element, ctx: Ctx): boolean {
    const r = el.getBoundingClientRect();
    const t = r.top + ctx.oy, l = r.left + ctx.ox;
    return t + r.height < 0 || t > VH || l + r.width < 0 || l > VW;
  }

  function childNodesOf(el: Element | Document | ShadowRoot): Node[] {
    if ((el as HTMLElement).shadowRoot) return Array.from((el as HTMLElement).shadowRoot!.childNodes);
    if ((el as Element).localName === 'slot') {
      const a = (el as HTMLSlotElement).assignedNodes({ flatten: true });
      return a.length ? a : Array.from(el.childNodes);
    }
    return Array.from(el.childNodes);
  }

  function pushText(out: RawNode[], t: string) {
    const last = out[out.length - 1];
    if (last && last.role === 'text' && !last._s) last.name += ' ' + t;
    else out.push({ role: 'text', name: t });
  }

  function walkKids(parent: Element | Document | ShadowRoot, ctx: Ctx): RawNode[] {
    const out: RawNode[] = [];
    for (const c of childNodesOf(parent)) {
      if (ctx.count > MAX_NODES) { ctx.stats.truncated = true; break; }
      if (c.nodeType === 3) {
        const t = collapse((c as Text).data);
        if (!t) continue;
        if (ctx.hide >= 2) {
          ctx.stats.hiddenText++;
          if (ctx.hide === 3) { ctx.stats.deceptiveText++; markEl(parent, 'hidden'); }
          sample(ctx, t);
          continue;
        }
        if (INJ.length && t.length > 12 && INJ.some((re) => re.test(t))) markEl(parent, 'inj');
        pushText(out, t);
      } else if (c.nodeType === 1) {
        for (const n of walkEl(c as Element, ctx)) {
          if (n.role === 'text' && !n._s) pushText(out, n.name!);
          else out.push(n);
        }
      }
    }
    return out;
  }

  function sample(ctx: Ctx, t: string) {
    if (ctx.stats.samples.length < 12 && t.length > 15) ctx.stats.samples.push(clip(t, 300));
  }

  function isVisuallyHiddenControl(el: Element): boolean {
    const v = verdict(el);
    return v === 2 || v === 3;
  }

  function controlNode(el: Element, role: string, ctx: Ctx, nameOverride?: string): RawNode {
    const cs = style(el);
    const name = nameOverride ?? accName(el, role);
    const sens = sensitiveKind(el);
    if (sens === 'password') ctx.signals.password++;
    else if (sens === 'card') ctx.signals.card++;
    else if (sens === 'otp') ctx.signals.otp++;
    else if (sens === 'id') ctx.signals.idField++;
    else if (sens === 'secret') ctx.signals.secretField++;
    const n: RawNode = { r: refFor(el, role, name), role };
    if (name) n.name = name;
    const val = valueOf(el, role, sens);
    if (val) n.val = val;
    const st = statesOf(el, role);
    if (st) n.st = st;
    if (sens) n.sens = sens;
    if (cs.display.startsWith('inline')) n.il = 1;
    if (offscreen(el, ctx)) n.off = 1;
    if (el.localName === 'select') {
      const o = Array.from((el as HTMLSelectElement).options);
      n.opts = o.slice(0, 6).map((x) => clip(collapse(x.text), 40));
      n.nopt = o.length;
    }
    if (role === 'link') {
      const href = el.getAttribute('href') || '';
      if (href && !href.startsWith('javascript:')) n.href = href;
    }
    ctx.count++;
    ctx.emitted.add(el);
    return n;
  }

  // ---------- rating hint: stars drawn with CSS classes have no text, so say the value ----------
  const RATING_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  function ratingHint(el: Element): string {
    const t = tokens(el);
    if (!(t.has('rating') || t.has('stars') || t.has('star') || t.has('rated'))) return '';
    if (textOf(el, 40, true)) return '';
    for (const w of t) {
      if (w in RATING_WORDS) return `rating ${RATING_WORDS[w]}/5`;
      if (/^[0-5](\.\d)?$/.test(w)) return `rating ${w}/5`;
    }
    return '';
  }

  function walkEl(el: Element, ctx: Ctx): RawNode[] {
    const tag = el.localName;
    if (SKIP_TAGS.has(tag) || ctx.emitted.has(el)) return [];
    if (tag === 'caption' || (tag === 'legend' && el.parentElement?.localName === 'fieldset') || (tag === 'figcaption' && el.parentElement?.localName === 'figure')) return [];
    const v = verdict(el);
    if (v === 1) {
      if (hasOwnText(el)) {
        ctx.stats.hiddenText++;
        // Visible to people but aria-hidden from assistive tech (and from us): show it in X-ray.
        if (el.getAttribute('aria-hidden') === 'true' && style(el).display !== 'none' && el.getBoundingClientRect().width > 2) markEl(el, 'hidden');
      }
      return [];
    }
    const cs = style(el);
    const hide = Math.max(ctx.hide, v);
    const role = roleOf(el, cs);

    // Visually hidden control with a visible label (custom checkbox pattern): surface it where the label is.
    if (tag === 'label' && hide < 2) {
      const ctl = (el as HTMLLabelElement).control;
      if (ctl && !ctx.emitted.has(ctl) && verdict(ctl) !== 1 && isVisuallyHiddenControl(ctl)) {
        const crole = roleOf(ctl, style(ctl));
        if (INTERACTIVE.has(crole)) return [controlNode(ctl, crole, ctx, clip(textOfLabel(el, ctl)))];
      }
    }

    if (hide === 2) {
      // sr-only / off-document subtree: drop text, keep nothing (labels are still used for names).
      const t = textOf(el, 400, true);
      if (t) { ctx.stats.hiddenText++; sample(ctx, t); }
      return [];
    }

    if (tag === 'svg' || tag === 'canvas' || tag === 'video' || tag === 'audio') {
      if (INTERACTIVE.has(role)) return [controlNode(el, role, ctx)];
      const label = el.getAttribute('aria-label');
      if (tag === 'svg') return [];
      return label || tag !== 'canvas' ? [{ role: tag, name: label || '' }] : [];
    }

    if (tag === 'iframe') {
      let doc: Document | null = null;
      try { doc = (el as HTMLIFrameElement).contentDocument; } catch { /* cross-origin */ }
      const name = accName(el, 'iframe');
      const src = el.getAttribute('src') || '';
      if (/challenges\.cloudflare\.com|hcaptcha\.com|recaptcha|arkoselabs|funcaptcha|captcha/i.test(src)) ctx.signals.challenge ||= 'captcha iframe';
      if (!doc || !doc.body) {
        ctx.signals.xframes++;
        let host = '';
        try { host = new URL(src, location.href).host; } catch { /* ignore */ }
        return [{ r: refFor(el, 'iframe', name || host), role: 'iframe', name: name || host, st: 'cross-origin' }];
      }
      const r = el.getBoundingClientRect();
      const sub: Ctx = { ...ctx, ox: ctx.ox + r.left, oy: ctx.oy + r.top, hide };
      const kids = walkKids(doc.body, sub);
      ctx.count = sub.count;
      return kids.length ? [{ r: refFor(el, 'iframe', name), role: 'iframe', name, kids }] : [];
    }

    if (INTERACTIVE.has(role) && hide < 2) {
      const n = controlNode(el, role, ctx);
      if (!LEAF_INTERACTIVE.has(role) && el.querySelector(IA_SEL)) {
        // A clickable card containing other controls: keep it, and descend.
        const sub = { ...ctx, hide };
        const kids = walkKids(el, sub);
        ctx.count = sub.count;
        if (kids.length) { n.kids = kids; if (n.name && n.name.length > 40) n.name = clip(n.name, 40); }
      }
      return [n];
    }

    if (role === 'heading') {
      ctx.count++;
      const lvl = +(el.getAttribute('aria-level') || tag.slice(1)) || 2;
      if (el.querySelector(IA_SEL)) {
        const sub = { ...ctx, hide };
        const kids = walkKids(el, sub);
        ctx.count = sub.count;
        return kids.length ? [{ role: 'heading', lvl, kids, r: refFor(el, 'heading', textOf(el)), _s: 1 }] : [];
      }
      const name = hide === 3 ? '' : accName(el, role);
      if (!name) { const ht = hide === 3 ? textOf(el, 300, true) : ''; if (ht) { ctx.stats.hiddenText++; ctx.stats.deceptiveText++; sample(ctx, ht); markEl(el, 'hidden'); } return []; }
      const n: RawNode = { role: 'heading', lvl, name, r: refFor(el, 'heading', name), _s: 1 };
      if (offscreen(el, ctx)) n.off = 1;
      return [n];
    }

    if (role === 'img') {
      if (hide >= 2) return [];
      const name = accName(el, role);
      const r = el.getBoundingClientRect();
      return name && r.width > 24 && r.height > 24 ? [{ role: 'img', name, _s: 1 }] : [];
    }

    if (role === 'progressbar' || role === 'meter') {
      return [{ role, name: accName(el, role), val: valueOf(el, role, '') || el.getAttribute('value') || '' }];
    }

    if (!role && hide < 2) {
      const rating = ratingHint(el);
      if (rating) return [{ role: 'text', name: rating, _s: 1 }];
    }

    const isContainer = !!role && CONTAINERS.has(role);
    const anon = role === 'listitem' || role === 'row' || role === 'cell' || role === 'gridcell' || role === 'rowgroup' || role === 'columnheader' || role === 'rowheader';
    const cname = isContainer && !anon ? accName(el, role) : '';
    const cref = isContainer && !anon ? refFor(el, role, cname) : undefined;
    const sub = { ...ctx, hide };
    const kids = walkKids(el, sub);
    ctx.count = sub.count;

    if (isContainer) {
      if (!kids.length) return [];
      ctx.count++;
      const n: RawNode = { role, kids, _s: 1 };
      if (cname) n.name = cname;
      if (cref !== undefined) n.r = cref;
      if (role === 'table' || role === 'grid' || role === 'treegrid') {
        const rows = el.querySelectorAll('tr,[role=row]').length;
        const first = el.querySelector('tr,[role=row]');
        const cols = first ? first.querySelectorAll('th,td,[role=cell],[role=gridcell],[role=columnheader]').length : 0;
        n.shape = [rows, cols];
      }
      if ((role === 'dialog' || role === 'alertdialog') && (el as HTMLDialogElement).open !== false) n.st = 'open';
      if (offscreen(el, ctx)) n.off = 1;
      return [n];
    }

    // Generic element: transparent. Seal text at block boundaries; group inline runs into a single line.
    const block = !cs.display.startsWith('inline');
    if (block) {
      const hasText = kids.some((k) => k.role === 'text');
      const isOff = hasText && offscreen(el, ctx);
      const allInline = kids.every((k) => k.role === 'text' || (k.il && !k.kids));
      if (hasText && allInline && kids.length > 1) {
        const line: RawNode = { role: 'line', kids, _s: 1 };
        if (isOff) line.off = 1;
        return [line];
      }
      for (const k of kids) if (k.role === 'text') { k._s = 1; if (isOff) k.off = 1; }
    }
    return kids;
  }

  function snapshot(opts: { root?: number } = {}): RawSnapshot {
    const t0 = performance.now();
    CS = new Map(); VC = new Map(); fpCounts = new Map(); newFp2ref = new Map();
    VW = innerWidth; VH = innerHeight;
    if (!opts.root) { MARKS = []; MAIN_GUESS = guessMain(); }
    const signals: PageSignals = { password: 0, card: 0, otp: 0, idField: 0, secretField: 0, challenge: '', xframes: 0 };
    const ctx: Ctx = { hide: 0, ox: 0, oy: 0, count: 0, stats: { hiddenText: 0, deceptiveText: 0, truncated: false, samples: [] }, signals, emitted: new Set() };
    let rootEl: Element | null = opts.root ? resolve(opts.root) : document.body;
    if (!rootEl) rootEl = document.body || document.documentElement;
    const kids = rootEl === document.body || !rootEl ? walkKids(document.body || document.documentElement, ctx) : walkEl(rootEl, ctx);
    if (!opts.root) {
      // Merge maps only on full snapshots so subtree reads do not forget refs elsewhere.
      S.fp2ref = newFp2ref;
      if (S.ref2el.size > 20000) for (const [r, w] of S.ref2el) if (!w.deref()?.isConnected) S.ref2el.delete(r);
    } else for (const [k, r] of newFp2ref) S.fp2ref.set(k, r);
    challengeSignals(signals);
    const act = deepActive();
    return {
      url: location.href,
      title: document.title,
      vw: VW, vh: VH, sy: Math.round(scrollY), sh: Math.round(document.documentElement.scrollHeight),
      focus: act ? S.el2ref.get(act) : undefined,
      root: { role: 'root', kids },
      stats: { nodes: ctx.count, hiddenText: ctx.stats.hiddenText, deceptiveText: ctx.stats.deceptiveText, truncated: ctx.stats.truncated, ms: Math.round(performance.now() - t0), hiddenSamples: ctx.stats.samples },
      signals,
      nextRef: S.next,
    };
  }

  function challengeSignals(sig: PageSignals) {
    if (sig.challenge) return;
    const t = document.title;
    if (/just a moment|attention required|verify you are human|are you a robot/i.test(t)) sig.challenge = 'interstitial: ' + t;
    else if (document.querySelector('#challenge-form,#cf-challenge-running,.cf-turnstile,[data-sitekey],.g-recaptcha,.h-captcha')) sig.challenge = 'captcha widget';
  }

  // ---------- find: grep the page instead of reading it ----------
  function find(q: string, limit = 12): FindHit[] {
    CS = new Map(); VC = new Map(); fpCounts = new Map(); newFp2ref = new Map();
    VW = innerWidth; VH = innerHeight;
    let roleFilter = '';
    const m = q.match(/^(\w+):\s*(.*)$/);
    if (m && /^(button|link|textbox|input|checkbox|radio|combobox|select|heading|tab|option|menuitem|img|text|switch|clickable)$/i.test(m[1])) {
      roleFilter = m[1].toLowerCase().replace(/^input$/, 'textbox').replace(/^select$/, 'combobox');
      q = m[2];
    }
    const words = collapse(q.toLowerCase()).split(' ').filter(Boolean);
    const hits: FindHit[] = [];
    const signals: PageSignals = { password: 0, card: 0, otp: 0, idField: 0, secretField: 0, challenge: '', xframes: 0 };
    const ctx: Ctx = { hide: 0, ox: 0, oy: 0, count: 0, stats: { hiddenText: 0, deceptiveText: 0, truncated: false, samples: [] }, signals, emitted: new Set() };
    const tree = walkKids(document.body, ctx);
    for (const [k, r] of newFp2ref) S.fp2ref.set(k, r);
    let heading = '';
    // Score: fraction of query words present (+ bonus for the exact phrase, + small bonus for short labels).
    const score = (hay: string) => {
      if (!words.length) return 1;
      const h = hay.toLowerCase();
      let hit = 0;
      for (const w of words) if (h.includes(w)) hit++;
      if (!hit) return 0;
      let sc = hit / words.length;
      if (h.includes(words.join(' '))) sc += 0.5;
      return sc + 0.1 / (1 + hay.length / 40);
    };
    const visit = (n: RawNode) => {
      if (n.role === 'heading') heading = n.name || (n.kids ? n.kids.map((k) => k.name || '').join(' ') : '');
      const role = n.role;
      const okRole = !roleFilter || role === roleFilter || (roleFilter === 'text' && (role === 'text' || role === 'line'));
      if (okRole && role !== 'root') {
        const label = role === 'line' ? (n.kids || []).map((k) => k.name || '').join(' ') : n.name || '';
        const hay = [label, n.val && !n.sens ? n.val : '', n.href || ''].join(' ');
        const s = score(hay);
        if (s > 0 && (label || n.r) && !CONTAINERS.has(role)) {
          hits.push({ r: n.r, role: role === 'line' ? 'text' : role, name: clip(label, 140), val: n.val, st: n.st, href: n.href, ctx: heading ? clip(heading, 50) : undefined, off: n.off, score: s + (n.r ? 0.05 : 0) });
        }
      }
      for (const k of n.kids || []) visit(k);
    };
    for (const n of tree) visit(n);
    hits.sort((a, b) => b.score - a.score);
    // When some hits match every word, drop the partial matches.
    const all = hits.filter((h) => h.score >= 1);
    return (all.length ? all : hits).slice(0, limit);
  }

  // ---------- query: count and list elements by CSS selector (read-only, no script runs) ----------
  interface QueryHit { tag: string; text: string; attrs: string[]; r?: number }
  function query(selector: string, limit = 12): { total: number; shown: number; hits: QueryHit[] } | { error: string } {
    let list: Element[];
    try { list = Array.from(document.querySelectorAll(selector)); } catch { return { error: 'bad selector' }; }
    CS = new Map(); VC = new Map(); fpCounts = new Map(); newFp2ref = new Map();
    VW = innerWidth; VH = innerHeight;
    const seen = list.filter((el) => verdict(el) === 0);
    const hits = seen.slice(0, limit).map((el) => {
      const attrs: string[] = [];
      const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : el.getAttribute('class') || '';
      if (cls) attrs.push(`class="${clip(collapse(cls), 60)}"`);
      for (const a of ['id', 'aria-label', 'title', 'alt', 'href', 'name', 'type', 'data-testid']) {
        const v = el.getAttribute(a);
        if (v) attrs.push(`${a}="${clip(collapse(v), 60)}"`);
      }
      const r = S.el2ref.get(el);
      return { tag: el.localName, text: clip(textOf(el, 80), 80), attrs, ...(r ? { r } : {}) };
    });
    return { total: seen.length, shown: hits.length, hits };
  }

  // ---------- action helpers ----------
  function frameOffset(el: Element): { x: number; y: number } {
    let x = 0, y = 0;
    let w: Window | null = el.ownerDocument.defaultView;
    while (w && w.frameElement) {
      const r = w.frameElement.getBoundingClientRect();
      x += r.left; y += r.top;
      w = w.parent;
    }
    return { x, y };
  }

  function targetFor(el: Element): Element {
    if (isVisuallyHiddenControl(el)) {
      const lab = (el as HTMLInputElement).labels?.[0];
      if (lab) return lab;
    }
    return el;
  }

  function describeEl(el: Element | null): string {
    if (!el) return 'nothing';
    const r = S.el2ref.get(el);
    let role = '';
    try { role = roleOf(el, style(el)); } catch { /* ignore */ }
    const name = accName(el, role || 'clickable') || clip(collapse(el.textContent || ''), 40);
    return `${r ? '[' + r + '] ' : ''}${role || el.localName}${name ? ' "' + clip(name, 50) + '"' : ''}`;
  }

  function point(ref: number): PointResult | { error: string } {
    CS = new Map(); VC = new Map();
    const el0 = resolve(ref);
    if (!el0) return { error: 'gone' };
    const el = targetFor(el0);
    const r0 = el.getBoundingClientRect();
    const off = frameOffset(el);
    if (r0.top + off.y < 0 || r0.bottom + off.y > innerHeight || r0.left + off.x < 0 || r0.right + off.x > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    }
    const r = el.getBoundingClientRect();
    const o = frameOffset(el);
    if (r.width === 0 && r.height === 0) return { x: 0, y: 0, ok: false, obscuredBy: 'element has no size (not rendered)' };
    const pts: [number, number][] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + Math.min(8, r.width / 4), r.top + r.height / 2],
      [r.right - Math.min(8, r.width / 4), r.top + r.height / 2],
      [r.left + r.width / 2, r.top + Math.min(6, r.height / 4)],
    ];
    let blocker: Element | null = null;
    for (const [x, y] of pts) {
      const doc = el.ownerDocument;
      let hit: Element | null = doc.elementFromPoint(x, y);
      while (hit && (hit as HTMLElement).shadowRoot) {
        const inner = (hit as HTMLElement).shadowRoot!.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      if (hit && (hit === el || el.contains(hit) || hit.contains(el) || (el0 !== el && (el0 === hit || el0.contains(hit))) ||
          (hit.getRootNode() as ShadowRoot).host && el.contains((hit.getRootNode() as ShadowRoot).host))) {
        return { x: Math.round(x + o.x), y: Math.round(y + o.y), ok: true, rect: { x: r.left + o.x, y: r.top + o.y, width: r.width, height: r.height } } as PointResult;
      }
      blocker ||= hit;
    }
    const [cx, cy] = pts[0];
    let br: number | undefined;
    for (let b: Element | null = blocker; b; b = b.parentElement) { const rr = S.el2ref.get(b); if (rr) { br = rr; break; } }
    return { x: Math.round(cx + o.x), y: Math.round(cy + o.y), ok: false, obscuredBy: describeEl(blocker), obscuredRef: br };
  }

  function focusForTyping(ref: number, clear: boolean): { ok: boolean; error?: string; kind?: string } {
    const el = resolve(ref) as HTMLElement | null;
    if (!el) return { ok: false, error: 'gone' };
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    el.focus();
    if (clear) {
      if (el.localName === 'input' || el.localName === 'textarea') (el as HTMLInputElement).select();
      else if (el.isContentEditable) {
        const sel = el.ownerDocument.getSelection();
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    return { ok: el.ownerDocument.activeElement === el || el.contains(el.ownerDocument.activeElement), kind: sensitiveKind(el) };
  }

  function selectOption(ref: number, wanted: string[]): { ok: boolean; picked?: string[]; error?: string; options?: string[] } {
    const el = resolve(ref);
    if (!el) return { ok: false, error: 'gone' };
    if (el.localName !== 'select') return { ok: false, error: 'not a native <select>; click it and pick the option instead' };
    const sel = el as HTMLSelectElement;
    const opts = Array.from(sel.options);
    const norm = (s: string) => collapse(s).toLowerCase();
    const picked: string[] = [];
    for (const o of opts) o.selected = false;
    for (const w of wanted) {
      const n = norm(w);
      const o = opts.find((x) => norm(x.text) === n || x.value.toLowerCase() === n) || opts.find((x) => norm(x.text).includes(n));
      if (!o) return { ok: false, error: `no option "${w}"`, options: opts.slice(0, 30).map((x) => collapse(x.text)) };
      o.selected = true;
      picked.push(collapse(o.text));
      if (!sel.multiple) break;
    }
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, picked };
  }

  function scroll(ref: number | null, dy: number): { sy: number; sh: number; atEnd: boolean } {
    if (ref) {
      const el = resolve(ref);
      if (el) {
        // Scroll the element itself if it is a scroll container, otherwise bring it into view.
        const cs = getComputedStyle(el);
        if (dy && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) el.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
        else el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      }
    } else window.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
    const sh = document.documentElement.scrollHeight;
    return { sy: Math.round(scrollY), sh, atEnd: scrollY + innerHeight >= sh - 2 };
  }

  function waitQuiet(quietMs = 250, timeoutMs = 3000): Promise<{ quiet: boolean; ms: number }> {
    const t0 = performance.now();
    return new Promise((res) => {
      let timer: any;
      const done = (quiet: boolean) => { mo.disconnect(); clearTimeout(timer); clearTimeout(hard); res({ quiet, ms: Math.round(performance.now() - t0) }); };
      const mo = new MutationObserver((recs) => {
        if (recs.every(ours)) return;
        clearTimeout(timer);
        timer = setTimeout(() => done(true), quietMs);
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      timer = setTimeout(() => done(true), quietMs);
      const hard = setTimeout(() => done(false), timeoutMs);
    });
  }

  function describe(ref: number): Describe | null {
    CS = new Map(); VC = new Map();
    const el = resolve(ref);
    if (!el) return null;
    const role = roleOf(el, style(el));
    return {
      role, name: accName(el, role), tag: el.localName, sens: sensitiveKind(el) || undefined,
      type: (el as HTMLInputElement).type || undefined, href: el.getAttribute('href') || undefined,
      form: !!(el as HTMLInputElement).form,
      checked: (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true',
    };
  }

  // ---------- typed extractors ----------
  function cellText(el: Element): string {
    const parts: string[] = [];
    const t = textOf(el, 300);
    if (t) parts.push(t);
    const a = el.querySelector('a[href]');
    if (a && el.querySelectorAll('a[href]').length === 1) parts.push('<' + a.getAttribute('href') + '>');
    return clip(parts.join(' '), 160);
  }

  function table(ref: number | null, offset = 0, limit = 50): { rows: string[][]; total: number; header?: string[] } | { error: string } {
    CS = new Map(); VC = new Map();
    let el: Element | null = ref ? resolve(ref) : document.querySelector('table,[role=table],[role=grid]');
    if (!el) return { error: ref ? 'gone' : 'no table on page' };
    if (!el.matches('table,[role=table],[role=grid],[role=treegrid]')) el = el.querySelector('table,[role=table],[role=grid]') || el;
    const rowsEl = Array.from(el.querySelectorAll('tr,[role=row]')).filter((r) => r.closest('table,[role=table],[role=grid],[role=treegrid]') === el && verdict(r) !== 1);
    const toCells = (r: Element) => Array.from(r.querySelectorAll(':scope > th, :scope > td, :scope > [role=cell], :scope > [role=gridcell], :scope > [role=columnheader], :scope > [role=rowheader]')).map(cellText);
    let header: string[] | undefined;
    let body = rowsEl;
    if (rowsEl.length && rowsEl[0].querySelector(':scope > th, :scope > [role=columnheader]') && !rowsEl[0].querySelector(':scope > td')) {
      header = toCells(rowsEl[0]);
      body = rowsEl.slice(1);
    }
    return { header, rows: body.slice(offset, offset + limit).map(toCells), total: body.length };
  }

  // Repeated items (product cards, search results) -> aligned columns, no LLM needed.
  function list(ref: number | null, offset = 0, limit = 40): { cols: string[]; rows: string[][]; total: number } | { error: string } {
    CS = new Map(); VC = new Map();
    let container: Element | null = ref ? resolve(ref) : null;
    if (ref && !container) return { error: 'gone' };
    if (!container) container = bestRepeatedContainer();
    if (!container) return { error: 'no repeated items found; pass a list/container ref' };
    const items = repeatedChildren(container);
    if (items.length < 2) return { error: 'container has fewer than 2 similar items' };
    const sigOf = (el: Element, root: Element) => {
      const p: string[] = [];
      for (let a: Element | null = el; a && a !== root; a = a.parentElement) p.unshift(a.localName);
      return p.join('>');
    };
    const colIndex = new Map<string, number>();
    const counts: number[] = [];
    const data: Map<number, string>[] = [];
    for (const it of items) {
      const row = new Map<number, string>();
      const leaves: [string, string][] = [];
      const visit = (el: Element) => {
        const v = verdict(el);
        if (v === 1 || v === 2) return;
        if (el.localName === 'a' && el.getAttribute('href')) {
          const t = textOf(el, 150);
          if (t) leaves.push([sigOf(el, it) + '#a', t]);
          leaves.push([sigOf(el, it) + '#href', el.getAttribute('href')!]);
          return;
        }
        if (el.localName === 'img') { const alt = (el as HTMLImageElement).alt; if (alt) leaves.push([sigOf(el, it) + '#img', alt]); return; }
        if (hasOwnText(el) && v === 0) {
          const own = collapse(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n as Text).data).join(' '));
          if (own) leaves.push([sigOf(el, it), own]);
        }
        for (const c of Array.from(el.children)) visit(c);
      };
      visit(it);
      const seen = new Map<string, number>();
      for (const [k0, t] of leaves) {
        const n = (seen.get(k0) || 0) + 1;
        seen.set(k0, n);
        const k = k0 + '~' + n;
        let ci = colIndex.get(k);
        if (ci === undefined) { ci = colIndex.size; colIndex.set(k, ci); counts[ci] = 0; }
        if (!row.has(ci)) { row.set(ci, clip(t, 120)); counts[ci]++; }
      }
      data.push(row);
    }
    // Keep columns present in at least 30% of items, in first-seen order; drop duplicate href-only columns.
    const keep = [...colIndex.entries()].filter(([, i]) => counts[i] >= Math.max(2, items.length * 0.3)).map(([k, i]) => ({ k, i }));
    const cols = keep.map(({ k }) => (k.includes('#href') ? 'url' : k.includes('#a') ? 'link' : k.includes('#img') ? 'img' : 'text'));
    const rows = data.slice(offset, offset + limit).map((row) => keep.map(({ i }) => row.get(i) || ''));
    return { cols, rows, total: items.length };
  }

  function shapeSig(el: Element): string {
    return el.localName + '.' + Array.from(el.children).slice(0, 6).map((c) => c.localName).join(',');
  }
  function repeatedChildren(container: Element): Element[] {
    const kids = Array.from(container.children).filter((c) => verdict(c) !== 1 && !SKIP_TAGS.has(c.localName));
    const bySig = new Map<string, Element[]>();
    for (const k of kids) { const s = shapeSig(k); const a = bySig.get(s) || []; a.push(k); bySig.set(s, a); }
    let best: Element[] = [];
    for (const a of bySig.values()) if (a.length > best.length) best = a;
    return best;
  }
  function bestRepeatedContainer(): Element | null {
    let best: Element | null = null, bestScore = 0;
    const scope = document.querySelector('main,[role=main]') || document.body;
    for (const el of Array.from(scope.querySelectorAll('ul,ol,div,section,tbody,[role=list],[role=feed]'))) {
      if (el.childElementCount < 3 || verdict(el) === 1 || el.closest('table,[role=table],[role=grid]')) continue;
      const items = repeatedChildren(el);
      if (items.length < 3) continue;
      const textLen = Math.min(400, collapse(items[0].textContent || '').length);
      const score = items.length * (1 + textLen / 40) * (el.closest('nav,header,footer') ? 0.2 : 1);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // ---------- read: main content as compact markdown ----------
  function read(ref: number | null, links: boolean): { md: string; ref?: number } | { error: string } {
    CS = new Map(); VC = new Map();
    let root: Element | null = ref ? resolve(ref) : null;
    if (ref && !root) return { error: 'gone' };
    if (!root) root = document.querySelector('main,[role=main],article') || document.body;
    const lines: string[] = [];
    let cur = '';
    const flush = () => { const t = collapse(cur); if (t) lines.push(t); cur = ''; };
    const BOILER = /^(nav|header|footer|aside)$/;
    const visit = (n: Node, depth: number, inPre: boolean) => {
      if (n.nodeType === 3) { cur += inPre ? (n as Text).data : ' ' + (n as Text).data; return; }
      if (n.nodeType !== 1) return;
      const el = n as Element;
      const tag = el.localName;
      if (SKIP_TAGS.has(tag) || tag === 'svg' || tag === 'button' || tag === 'form' || tag === 'select' || tag === 'input' || tag === 'textarea') return;
      const v = verdict(el);
      if (v !== 0) return;
      if (root === document.body && BOILER.test(tag) && el !== root) return;
      const role = el.getAttribute('role');
      if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return;
      if (/^h[1-6]$/.test(tag)) { flush(); lines.push('#'.repeat(+tag[1]) + ' ' + textOf(el, 200)); return; }
      if (tag === 'table') {
        flush();
        const t = table(S.el2ref.get(el) ?? refFor(el, 'table', ''), 0, 30);
        if (!('error' in t)) {
          if (t.header) lines.push(t.header.join(' | '));
          for (const r of t.rows) lines.push(r.join(' | '));
          if (t.total > 30) lines.push(`(+${t.total - 30} rows: extract table)`);
        }
        CS = new Map(); VC = new Map();
        return;
      }
      if (tag === 'pre') { flush(); lines.push('```\n' + clip((el.textContent || '').trim(), 1500) + '\n```'); return; }
      if (tag === 'img') { const alt = (el as HTMLImageElement).alt; if (alt && links) cur += ` [img: ${alt}] `; return; }
      if (tag === 'a' && links && el.getAttribute('href')) { cur += ` [${textOf(el, 120)}](${el.getAttribute('href')}) `; return; }
      if (tag === 'br') { flush(); return; }
      const block = !style(el).display.startsWith('inline');
      if (block) flush();
      if (tag === 'li') cur += '- ';
      if (tag === 'blockquote') cur += '> ';
      for (const c of childNodesOf(el)) visit(c, depth + 1, inPre || tag === 'pre');
      if (block) flush();
    };
    visit(root, 0, false);
    flush();
    // drop consecutive duplicates (repeated labels, "Read more" spam)
    const out: string[] = [];
    for (const l of lines) if (l !== out[out.length - 1] && l !== '-') out.push(l);
    return { md: out.join('\n'), ref: S.el2ref.get(root) };
  }

  function signals(): PageSignals {
    const s = snapshot({}).signals;
    return s;
  }

  // Blur sensitive fields for screenshots (returns an undo token).
  function mark(on: boolean): number {
    const id = 'wb-redact-style';
    document.getElementById(id)?.remove();
    if (!on) return 0;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = 'input[type=password],input[autocomplete*="cc-"],input[autocomplete="one-time-code"],[data-wb-sens]{filter:blur(6px)!important}';
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('input,textarea'))) if (sensitiveKind(el)) { el.setAttribute('data-wb-sens', ''); n++; }
    document.documentElement.appendChild(st);
    return n;
  }


  // ---------- visual layer: X-ray + ghost cursor ----------
  // Lives in a closed shadow root on a pointer-events:none host. Skipped by the walker, ignored by waitQuiet.
  let host: HTMLElement | null = null;
  let layerRoot: ShadowRoot | null = null;
  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    .o{position:fixed;border:1.5px solid rgba(20,20,20,.7);border-radius:4px}
    .o.s{border:1.5px dotted #141414}
    .o.h{border:1.5px dashed #0a7d5a;background:rgba(10,125,90,.08)}
    .o.i{border:2px solid #0a7d5a;background:rgba(10,125,90,.12)}
    .b{position:fixed;transform:translate(-4px,-60%);padding:0 4px;height:15px;line-height:15px;border-radius:4px;background:#141414;color:#fff;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.25)}
    .b.s{background:#141414}.b.h,.b.i{background:#0a7d5a;font-family:inherit}
    #legend{position:fixed;left:12px;bottom:12px;display:none;padding:6px 10px;border-radius:999px;background:rgba(24,24,27,.88);color:#fff;font:500 12px/1.2 inherit;box-shadow:0 4px 16px rgba(0,0,0,.25)}
    #legend b{color:#fff}
    #cur{position:fixed;left:0;top:0;width:22px;height:22px;opacity:0;transition:opacity .25s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));will-change:transform}
    #cap{position:fixed;left:0;top:0;padding:3px 8px;border-radius:6px;background:#18181b;color:#fff;font:500 12px/1.3 inherit;opacity:0;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;transition:opacity .2s;will-change:transform}
    .rip{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #0a7d5a;animation:rip .5s ease-out forwards}
    @keyframes rip{to{transform:scale(3.4);opacity:0}}`;
  function layer(): ShadowRoot {
    if (host && host.isConnected && layerRoot) return layerRoot;
    host = document.createElement(OVERLAY_TAG);
    host.setAttribute('style', 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block');
    layerRoot = host.attachShadow({ mode: 'closed' });
    layerRoot.innerHTML = `<style>${CSS}</style><div id="x"></div><div id="legend"></div><div id="cap"></div>` +
      `<svg id="cur" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.4-2.9 1.5-3.9-7.5L4 20z" fill="#18181b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(host);
    return layerRoot;
  }
  const $l = (id: string) => layer().getElementById(id) as HTMLElement;

  // X-ray: refs, masked fields and withheld text drawn over the real page.
  let xrayOn = false;
  let xrayItems: { el: Element; label: string; cls: string }[] = [];
  let xrayRaf = 0;
  let xrayTimer: any = null;
  const xrayActive = () => xrayOn && (isEngine || !document.documentElement.hasAttribute('data-wb-agent'));
  function xrayRender() {
    if (!xrayActive()) { if (layerRoot) { $l('x').innerHTML = ''; $l('legend').style.display = 'none'; } return; }
    const snap = snapshot({});
    const items: typeof xrayItems = [];
    let controls = 0, masked = 0;
    for (const [ref, w] of S.ref2el) {
      const el = w.deref();
      if (!el || !el.isConnected) continue;
      const role = roleOf(el, style(el));
      if (!INTERACTIVE.has(role)) continue;
      const sens = sensitiveKind(el);
      if (sens) masked++;
      controls++;
      items.push({ el: targetFor(el), label: sens ? `${ref} masked` : String(ref), cls: sens ? 's' : '' });
    }
    for (const m of MARKS) items.push({ el: m.el, label: m.kind === 'inj' ? 'looks like injection' : 'hidden from AI', cls: m.kind === 'inj' ? 'i' : 'h' });
    xrayItems = items.slice(0, 500);
    const hidden = MARKS.filter((m) => m.kind === 'hidden').length, inj = MARKS.filter((m) => m.kind === 'inj').length;
    const lg = $l('legend');
    lg.innerHTML = `X-ray · <b>${controls}</b> controls · <b>${masked}</b> masked · <b>${hidden}</b> hidden text blocked${inj ? ` · <b>${inj}</b> ⚠ injection` : ''} · ${snap.stats.ms}ms`;
    lg.style.display = 'block';
    xrayPlace();
  }
  function xrayPlace() {
    xrayRaf = 0;
    if (!xrayActive()) return;
    const box = $l('x');
    const frag = document.createDocumentFragment();
    for (const it of xrayItems) {
      const r = it.el.getBoundingClientRect();
      const o = frameOffset(it.el);
      const x = r.left + o.x, y = r.top + o.y;
      if (r.width < 2 || r.height < 2 || y + r.height < 0 || y > innerHeight || x + r.width < 0 || x > innerWidth) continue;
      const ol = document.createElement('div');
      ol.className = 'o ' + it.cls;
      ol.style.cssText = `left:${x - 2}px;top:${y - 2}px;width:${r.width + 4}px;height:${r.height + 4}px`;
      const b = document.createElement('div');
      b.className = 'b ' + it.cls;
      b.textContent = it.label;
      b.style.cssText = `left:${x}px;top:${y}px`;
      frag.append(ol, b);
    }
    box.replaceChildren(frag);
  }
  const xraySchedule = () => { if (xrayOn && !xrayRaf) xrayRaf = requestAnimationFrame(xrayPlace); };
  const xrayRefresh = () => { clearTimeout(xrayTimer); xrayTimer = setTimeout(xrayRender, 350); };
  function xray(on: boolean) {
    xrayOn = on;
    if (on) xrayRender();
    else if (layerRoot) { $l('x').innerHTML = ''; $l('legend').style.display = 'none'; }
    return on;
  }
  addEventListener('scroll', xraySchedule, { capture: true, passive: true });
  addEventListener('resize', xraySchedule, { passive: true });
  new MutationObserver((recs) => {
    if (!recs.every(ours)) S.mut++;
    for (const r of recs) {
      if (r.type === 'attributes' && r.target === document.documentElement) {
        if (r.attributeName === 'data-wb-xray') xray(document.documentElement.hasAttribute('data-wb-xray'));
        else if (r.attributeName === 'data-wb-agent' && xrayOn) xrayRender();
        continue;
      }
      if (xrayOn && !ours(r)) { xrayRefresh(); return; }
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wb-xray', 'data-wb-agent'], childList: true, subtree: true });
  if (document.documentElement.hasAttribute('data-wb-xray')) queueMicrotask(() => xray(true));

  // Ghost cursor: draws the real pointer (driven by the agent's CDP mouse events) and a caption. While the
  // agent is thinking it can also play an idle drift (ghostPath) that is drawn only: no input events, so
  // nothing on the page hovers or changes. While a demo is recorded (data-wb-rec) the caption and ripple
  // are left to Demo Studio.
  let cx = -40, cy = -40, hideT: any = null, following = false, ghostRaf = 0;
  // A real mouse move during idle drift can only be the user's (the agent isn't moving then): yield to them.
  let idle = false, userTook = false;
  const recording = () => document.documentElement.hasAttribute('data-wb-rec');
  function placeCursor() {
    const cur = $l('cur'), cap = $l('cap');
    cur.style.transform = `translate(${cx - 3}px,${cy - 2}px)`;
    cap.style.transform = `translate(${Math.min(cx + 18, innerWidth - 220)}px,${cy + 20}px)`;
  }
  addEventListener('mousemove', (e) => {
    if (!e.isTrusted) return;
    if (ghostRaf) { cancelAnimationFrame(ghostRaf); ghostRaf = 0; }
    if (idle) { idle = false; userTook = true; }
    cx = e.clientX; cy = e.clientY;
    if (following && layerRoot) placeCursor();
  }, { capture: true, passive: true });
  function cursor(o: { ref?: number; label?: string; x?: number; y?: number }): number {
    layer();
    const cur = $l('cur'), cap = $l('cap');
    following = true;
    idle = false; userTook = false;
    if (cx < 0) { cx = o.x ?? innerWidth / 2; cy = o.y ?? innerHeight - 40; }
    cur.style.transition = 'opacity .25s';
    cap.style.transition = 'opacity .2s';
    placeCursor();
    cur.style.opacity = '1';
    cap.textContent = o.label || '';
    cap.style.opacity = o.label && !recording() ? '1' : '0';
    hideLater(5000);
    return 0;
  }
  function hideLater(ms: number) {
    clearTimeout(hideT);
    hideT = setTimeout(() => { following = false; $l('cur').style.opacity = '0'; $l('cap').style.opacity = '0'; }, ms);
  }
  /** Play a drawn-only path (idle drift). Returns its duration in ms, or -1 once the user has the mouse. */
  function ghostPath(pts: { x: number; y: number; dt: number }[]): number {
    layer();
    if (ghostRaf) cancelAnimationFrame(ghostRaf);
    if (userTook) return -1;
    if (cx < 0 || !pts.length) return 0;
    idle = true;
    following = true;
    $l('cur').style.opacity = '1';
    $l('cap').style.opacity = '0';
    let i = 0, due = performance.now() + pts[0].dt;
    const total = pts.reduce((a, p) => a + p.dt, 0);
    const tick = (now: number) => {
      while (i < pts.length && now >= due) { cx = pts[i].x; cy = pts[i].y; i++; if (i < pts.length) due += pts[i].dt; }
      placeCursor();
      ghostRaf = i < pts.length ? requestAnimationFrame(tick) : 0;
    };
    ghostRaf = requestAnimationFrame(tick);
    hideLater(total + 8000);
    return total;
  }
  /** Stop any idle drift and report where the drawn cursor is, so the real pointer starts from there. */
  function ghostStop(): { x: number; y: number } | null {
    if (ghostRaf) { cancelAnimationFrame(ghostRaf); ghostRaf = 0; }
    idle = false;
    return cx < 0 ? null : { x: Math.round(cx), y: Math.round(cy) };
  }
  /** Things a reader's eye (and idle hand) would drift to: headings, text, links, images in view. */
  function readingPoints(limit = 40): { w: number; h: number; pts: { x: number; y: number }[] } {
    const out: { x: number; y: number }[] = [];
    const els = document.querySelectorAll('h1,h2,h3,p,li,a,img,button,td,blockquote,figcaption');
    for (let i = 0; i < els.length && out.length < limit; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.width < 16 || r.height < 8 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      // Text is read from the left, so aim at the first third of the line.
      out.push({ x: Math.round(r.left + Math.min(r.width, 600) * (0.1 + Math.random() * 0.4)), y: Math.round(r.top + Math.min(r.height, 40) / 2) });
    }
    return { w: innerWidth, h: innerHeight, pts: out };
  }
  function clickFx() {
    if (recording()) return;
    const d = document.createElement('div');
    d.className = 'rip';
    d.style.left = cx + 'px';
    d.style.top = cy + 'px';
    layer().appendChild(d);
    setTimeout(() => d.remove(), 600);
  }

  // Candidate result links for research mode: first link of each repeated item, else long links in main.
  function topLinks(limit = 5): { url: string; text: string }[] {
    CS = new Map(); VC = new Map();
    const out: { url: string; text: string }[] = [];
    const seen = new Set<string>();
    const here = location.href.split('#')[0];
    const push = (a: Element | null) => {
      if (!a || out.length >= limit) return;
      const href = (a as HTMLAnchorElement).href;
      if (!href || !/^https?:/.test(href) || href.split('#')[0] === here || verdict(a) !== 0) return;
      let u: URL;
      try { u = new URL(href); } catch { return; }
      // Skip search-engine redirect wrappers by unwrapping uddg/url/q params.
      for (const k of ['uddg', 'url', 'q', 'u']) { const v = u.searchParams.get(k); if (v && /^https?:/.test(v)) { try { u = new URL(v); } catch { /* keep */ } break; } }
      const key = u.host + u.pathname;
      if (seen.has(key)) return;
      const text = textOf(a, 120);
      if (text.length < 4) return;
      seen.add(key);
      out.push({ url: u.href, text: clip(text, 100) });
    };
    const c = bestRepeatedContainer();
    if (c) for (const it of repeatedChildren(c)) push(it.querySelector('a[href]'));
    if (out.length < limit) {
      const scope = document.querySelector('main,[role=main]') || document.body;
      for (const a of Array.from(scope.querySelectorAll('a[href]'))) {
        if (a.closest('nav,header,footer,[role=navigation]')) continue;
        if (textOf(a, 120).length >= 20) push(a);
      }
    }
    return out;
  }

  G.__wb = {
    init(o: { nextRef?: number; inj?: string[]; engine?: boolean; xray?: boolean }) {
      if (o.nextRef && o.nextRef > S.next) S.next = o.nextRef;
      if (o.inj) INJ = o.inj.map((x) => new RegExp(x, 'i'));
      if (o.engine) { isEngine = true; document.documentElement.setAttribute('data-wb-agent', ''); }
      if (o.xray) document.documentElement.setAttribute('data-wb-xray', '');
      return S.next;
    },
    xray, cursor, clickFx, ghostPath, ghostStop, readingPoints, topLinks,
    ghostPos: () => (cx < 0 ? null : { x: Math.round(cx), y: Math.round(cy) }),
    mutVersion: () => S.mut,
    // Indices into document.querySelectorAll('*') from the main-world probe. Delegation roots
    // (big containers with many controls) are ignored unless the handler came from React props.
    markClick(listen: number[], react: number[]) {
      const all = document.querySelectorAll('*');
      const area = innerWidth * innerHeight;
      for (const i of react) { const el = all[i]; if (el) S.click.add(el); }
      for (const i of listen) {
        const el = all[i];
        if (!el || el === document.body || el === document.documentElement) continue;
        const b = el.getBoundingClientRect();
        if (b.width * b.height > area * 0.4 || el.querySelectorAll(IA_SEL).length > 3) continue;
        S.click.add(el);
      }
      return S.click;
    },
    setXray: (on: boolean) => { document.documentElement.toggleAttribute('data-wb-xray', on); return xray(on); },
    snapshot, find, query, point, focusForTyping, selectOption, scroll, waitQuiet, describe, table, list, read, signals, mark,
    resolveOk: (r: number) => !!resolve(r),
    resolveEl: (r: number) => resolve(r),
  };
}

/** Source evaluated in the isolated world. The __name shim neutralises esbuild/tsx keepNames helpers. */
export const PAGE_AGENT_SOURCE = `(() => { var __name = (f) => f; (${installAgent.toString()})(); return true; })()`;
