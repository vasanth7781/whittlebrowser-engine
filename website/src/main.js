const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ---------- reveal + counters ----------
const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); e.target.dispatchEvent(new Event('inview')); }
}, { threshold: 0.18 });
$$('.reveal').forEach((el) => io.observe(el));
$$('[data-count]').forEach((el) => {
  el.closest('.reveal').addEventListener('inview', () => countUp(el, +el.dataset.count, el.dataset.suffix || ''), { once: true });
});
function countUp(el, to, suffix, ms = 1400) {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (Number.isInteger(to) ? fmt(to * e) : (to * e).toFixed(1)) + suffix;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- human-like pointer path (same model as the engine's humanized input) ----------
// Fitts's-law duration, minimum-jerk speed profile, curved path, small tremor, occasional overshoot.
function humanPath(from, to, width = 40) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1;
  const T = (180 + 140 * Math.log2(d / width + 1)) * (0.85 + Math.random() * 0.3);
  const nx = -dy / d, ny = dx / d;
  const bend = (Math.random() < 0.5 ? -1 : 1) * d * (0.08 + Math.random() * 0.18);
  const overshoot = d > 160 && Math.random() < 0.4;
  const end = overshoot ? { x: to.x + (dx / d) * d * (0.03 + Math.random() * 0.04), y: to.y + (dy / d) * d * (0.03 + Math.random() * 0.04) } : to;
  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
  const c2 = { x: from.x + dx * 0.75 + nx * bend * 0.4, y: from.y + dy * 0.75 + ny * bend * 0.4 };
  const ph1 = Math.random() * 6.28, ph2 = Math.random() * 6.28;
  const pts = [];
  const n = Math.max(8, Math.round(T / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n, s = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5, u = 1 - s;
    const tremor = (1 - t) * 1.1;
    pts.push({
      x: u ** 3 * from.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s ** 3 * end.x + Math.sin(t * 19 + ph1) * tremor,
      y: u ** 3 * from.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s ** 3 * end.y + Math.sin(t * 23 + ph2) * tremor,
      dt: T / n,
    });
  }
  if (overshoot) {
    const m = 7;
    for (let i = 1; i <= m; i++) { const t = i / m, s = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5; pts.push({ x: end.x + (to.x - end.x) * s, y: end.y + (to.y - end.y) * s, dt: 18 }); }
  }
  return pts;
}

// ---------- hero demo ----------
(function hero() {
  const win = $('.demo .win'), page = $('#dpage'), cur = $('#dcursor'), cap = $('#dcap'), ring = $('#dring'), feed = $('#dfeed');
  if (!win) return;
  let pos = { x: 420, y: 330 };
  const state = { pw: 0, ab: 0, pwCalls: 0, abCalls: 0 };
  const MAX = 3400;
  const place = (p) => { cur.style.transform = `translate(${p.x - 4}px, ${p.y - 3}px)`; cap.style.transform = `translate(${Math.min(p.x + 18, page.clientWidth - 190)}px, ${p.y + 20}px)`; };
  let lastTrail = 0;
  const trail = (p) => {
    const now = performance.now(); if (now - lastTrail < 26) return; lastTrail = now;
    const d = document.createElement('i'); d.className = 'trail'; d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
    page.appendChild(d); setTimeout(() => d.remove(), 560);
  };
  const rel = (el) => { const a = el.getBoundingClientRect(), b = page.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }; };
  async function moveTo(el, label) {
    const r = rel(el);
    const target = { x: r.x + r.w * (0.35 + Math.random() * 0.3), y: r.y + r.h * (0.4 + Math.random() * 0.2) };
    ring.style.cssText = `left:${r.x - 5}px;top:${r.y - 5}px;width:${r.w + 10}px;height:${r.h + 10}px;opacity:1`;
    cap.textContent = label; cap.style.opacity = 1;
    if (reduce) { pos = target; place(pos); return; }
    for (const p of humanPath(pos, target, r.w)) { place(p); trail(p); await sleep(p.dt); }
    pos = target; place(pos);
  }
  function click() {
    const d = document.createElement('div'); d.className = 'rip'; d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
    page.appendChild(d); setTimeout(() => d.remove(), 600);
  }
  async function typeInto(el, text) {
    el.classList.add('focus');
    const em = el.querySelector('em');
    em.textContent = '';
    for (const ch of text) { em.textContent += ch; await sleep(reduce ? 0 : 38 + Math.random() * 70 + (ch === ' ' || ch === '@' ? 90 : 0)); }
    await sleep(150);
    el.classList.remove('focus');
  }
  function meter(kind, add, note) {
    state[kind] += add; state[kind + 'Calls']++;
    $('#m-' + kind).textContent = fmt(state[kind]);
    $('#b-' + kind).style.width = Math.min(100, (state[kind] / MAX) * 100) + '%';
    $('#c-' + kind).textContent = `${state[kind + 'Calls']} call${state[kind + 'Calls'] > 1 ? 's' : ''} · ${note}`;
    const pct = state.pw ? Math.round((1 - state.ab / state.pw) * 100) : 0;
    $('#savedpct').textContent = pct + '%';
  }
  let nsteps = 0;
  function log(html) {
    const li = document.createElement('li'); li.innerHTML = html;
    const t = li.textContent.trim();
    // each kind of line gets its own icon (see .feed li::before in the stylesheet)
    li.className = /^(observe|act)\b/.test(t) ? 'k-call' : /^x-ray/.test(t) ? 'k-xray' : /^[Δ→]/.test(t) ? 'k-diff' : /^⚠/.test(t) ? 'k-warn' : /^✓/.test(t) ? 'k-ok' : 'k-step';
    feed.appendChild(li);
    while (feed.children.length > 7) feed.firstChild.remove();
    $('#fcount').textContent = `${++nsteps} step${nsteps > 1 ? 's' : ''}`;
  }
  function reset() {
    Object.assign(state, { pw: 0, ab: 0, pwCalls: 0, abCalls: 0 });
    for (const k of ['pw', 'ab']) { $('#m-' + k).textContent = '0'; $('#b-' + k).style.width = '0'; }
    $('#c-pw').textContent = '0 calls · full snapshot each time'; $('#c-ab').textContent = '0 calls · diffs, batched';
    $('#savedpct').textContent = '0%'; $('#saved').classList.remove('pop');
    page.classList.remove('review'); win.classList.remove('xray'); feed.innerHTML = ''; nsteps = 0; $('#fcount').textContent = '0 steps';
    $('#d-email em').textContent = ''; $('#d-name em').textContent = ''; $('#d-country em').textContent = 'United States';
    $('#d-gift').classList.remove('on'); $('#d-express').classList.remove('on'); $('#d-approve').classList.remove('show');
    ring.style.opacity = 0; cap.style.opacity = 0;
  }
  function badges() {
    const box = $('#dbadges'); box.innerHTML = '';
    const visible = page.querySelector(page.classList.contains('review') ? '.review-pg' : '.form-pg');
    for (const el of $$('[data-ref]', visible)) {
      const r = rel(el);
      box.insertAdjacentHTML('beforeend', `<div class="box" style="left:${r.x - 3}px;top:${r.y - 3}px;width:${r.w + 6}px;height:${r.h + 6}px"></div><div class="badge" style="left:${r.x}px;top:${r.y}px">${el.dataset.ref}</div>`);
    }
  }
  async function run() {
    for (;;) {
      reset(); place(pos);
      await sleep(700);
      log('<span class="t">observe</span> → page view');
      meter('pw', 457, 'full snapshot each time'); meter('ab', 204, 'diffs, batched');
      badges(); win.classList.add('xray');
      log('x-ray: 7 controls · refs [9]–[17]');
      await sleep(1700); win.classList.remove('xray');
      log('<span class="t">act</span> · 5 steps in 1 call');
      const steps = [
        ['#d-email', 'type · Email', async (el) => typeInto(el, 'jane@example.com'), 452],
        ['#d-name', 'type · Full name', async (el) => typeInto(el, 'Jane Doe'), 449],
        ['#d-country', 'select · Canada', async (el) => { click(); await sleep(250); el.querySelector('em').textContent = 'Canada'; }, 455],
        ['#d-gift', 'check · This is a gift', async (el) => { click(); el.classList.add('on'); }, 451],
        ['#d-express', 'click · Express', async (el) => { click(); el.classList.add('on'); }, 446],
      ];
      for (const [sel, label, fn, pwCost] of steps) {
        const el = $(sel);
        await moveTo(el, label);
        await fn(el);
        log(`  ${label}`);
        meter('pw', pwCost, 'full snapshot each time');
        await sleep(260);
      }
      meter('ab', 230, 'diffs, batched');
      log('Δ +1 −1 ~4 → <span class="t">230 tokens</span>');
      await sleep(500);
      const cont = $('#d-continue');
      await moveTo(cont, 'click · Continue to review');
      cont.classList.add('press'); click(); await sleep(140); cont.classList.remove('press');
      page.classList.add('review'); ring.style.opacity = 0;
      meter('pw', 457, 'full snapshot each time'); meter('ab', 71, 'diffs, batched');
      log('→ /checkout → /review · <span class="t">71 tokens</span>');
      await sleep(900);
      await moveTo($('#d-place'), 'click · Place order');
      $('#d-approve').classList.add('show');
      log('<span class="w">⚠ irreversible: waiting for you</span>');
      await sleep(1300);
      await moveTo($('#d-approve em'), 'you: Allow once');
      click(); await sleep(250);
      $('#d-approve').classList.remove('show');
      log('✓ approved by user · order placed');
      $('#saved').classList.add('pop');
      cap.style.opacity = 0; ring.style.opacity = 0;
      await sleep(3600);
    }
  }
  const start = () => { run(); };
  if ($('#demo').classList.contains('in')) start(); else $('#demo').addEventListener('inview', start, { once: true });
})();

// ---------- what the model sees ----------
fetch('data/samples.json').then((r) => r.json()).then((S) => {
  const hl = (t) => esc(t).replace(/\[(\d+)\]/g, '<span class="k">[$1]</span>').replace(/(&quot;|")([^"\n]*)\1/g, '<span class="s">"$2"</span>');
  const color = (t) => t.split('\n').map((l) => {
    const e = esc(l);
    if (/^✓/.test(l)) return `<span class="ok">${e}</span>`;
    if (/^Δ|^@/.test(l)) return `<span class="at">${e}</span>`;
    if (/^~/.test(l)) return `<span class="ch">${e}</span>`;
    if (/^\+/.test(l)) return `<span class="ad">${e}</span>`;
    if (/^[-−]/.test(l)) return `<span class="rm">${e}</span>`;
    if (/⚠/.test(l)) return `<span class="wa">${e}</span>`;
    return e.replace(/\[(\d+)\]/g, '<span class="k">[$1]</span>');
  }).join('\n');

  const vs = $('#vs');
  vs.addEventListener('inview', async () => {
    const pwPre = $('#vs-pw-text'), abPre = $('#vs-ab-text');
    pwPre.innerHTML = esc(S.pw.text);
    countUp($('#vs-pw'), S.pw.tokens, ' tokens', 3800);
    countUp($('#vs-ab'), S.ours.tokens, ' tokens', 1800);
    // Playwright snapshot keeps scrolling: there is always more of it.
    let y = 0;
    const scroll = () => { y += 0.6; pwPre.scrollTop = y % Math.max(1, pwPre.scrollHeight - pwPre.clientHeight); requestAnimationFrame(scroll); };
    if (!reduce) requestAnimationFrame(scroll);
    const lines = S.ours.text.split('\n');
    for (let i = 0; i < lines.length; i++) { abPre.innerHTML = color(lines.slice(0, i + 1).join('\n')); await sleep(reduce ? 0 : 55); }
  }, { once: true });

  const soup = $('#soup');
  soup.addEventListener('inview', async () => {
    $('#soup-html').innerHTML = esc(S.soup.html);
    const view = (S.soup.view + '\n\n' + S.soup.diff.split('\n').slice(1).join('\n')).split('\n');
    for (let i = 0; i < view.length; i++) { $('#soup-view').innerHTML = color(view.slice(0, i + 1).join('\n')); await sleep(reduce ? 0 : 70); }
  }, { once: true });

  const term = $('#diffterm');
  term.addEventListener('inview', async () => {
    $('#diff-tok').textContent = `${S.diff.tokens} tokens`;
    const lines = S.diff.text.split('\n');
    for (let i = 0; i < lines.length; i++) { $('#diff-text').innerHTML = color(lines.slice(0, i + 1).join('\n')); await sleep(reduce ? 0 : 320); }
  }, { once: true });
});

// ---------- x-ray demo ----------
(function xray() {
  const d = $('#xdemo');
  let auto = true;
  $('#xtoggle').addEventListener('click', () => { auto = false; d.classList.toggle('on'); });
  d.addEventListener('inview', async () => {
    while (auto) { d.classList.toggle('on'); await sleep(d.classList.contains('on') ? 4200 : 2200); }
  }, { once: true });
})();

// ---------- research demo ----------
(function research() {
  const root = $('#rdemo');
  const pages = [
    ['Grinder A review', 'coffeegeek.example', '58mm flat burrs · $349 · quiet, low retention'],
    ['Best grinders 2026', 'reviews.example', 'Ranks 9 models · budget pick under $150'],
    ['Grinder B vs C', 'espressoforum.example', 'Conical vs flat · C better for light roasts'],
    ['Grinder C manual', 'maker.example', '64mm burrs · stepless · 1.2 kg'],
    ['Long-term test', 'blog.example', 'B jammed after 8 months · A still fine'],
  ];
  const colors = ['#8b93ff', '#a78bfa', '#5eead4', '#fbbf24', '#fb7185'];
  async function run() {
    for (;;) {
      const seq = $('#r-seq'), par = $('#r-par'), tiles = $('#r-tiles'), rows = $('#r-rows');
      seq.innerHTML = ''; par.innerHTML = ''; rows.innerHTML = ''; $('#r-tok').textContent = '0 tokens';
      tiles.innerHTML = pages.map(([t, h]) => `<div class="tile"><div class="tc"><i></i>${esc(t)}</div><div class="pr"><i></i></div><div class="tb"><span></span><span></span><span></span><span></span></div></div>`).join('');
      const durs = pages.map(() => 900 + Math.random() * 1300);
      // sequential lane
      let acc = 0; const total = durs.reduce((a, b) => a + b, 0) + pages.length * 600;
      pages.forEach((p, i) => {
        const w = ((durs[i] + 600) / total) * 100;
        seq.insertAdjacentHTML('beforeend', `<div class="seg" style="left:${(acc / total) * 100}%;background:${colors[i]};transition-duration:0ms;opacity:0">${i + 1}</div>`);
        const seg = seq.lastElementChild;
        setTimeout(() => { seg.style.opacity = 1; seg.style.transitionDuration = (durs[i] + 600) * 1.6 + 'ms'; seg.style.width = w + '%'; }, acc * 1.6 + 50);
        acc += durs[i] + 600;
      });
      const t0 = performance.now();
      const seqTimer = setInterval(() => { const s = Math.min(total * 1.6, performance.now() - t0); $('#r-seq-t').textContent = (s / 1000 / 1.6 * 2.2).toFixed(1) + 's'; }, 60);
      // parallel lane + tiles
      const maxDur = Math.max(...durs);
      $$('.tile', tiles).forEach((tl, i) => setTimeout(() => tl.classList.add('show'), i * 80));
      pages.forEach((p, i) => {
        par.insertAdjacentHTML('beforeend', `<div class="seg" style="left:0;top:${4 + i * 13}px;height:10px;background:${colors[i]};transition-duration:${durs[i] * 1.6}ms"></div>`);
        const seg = par.lastElementChild, bar = $$('.tile .pr i', tiles)[i];
        bar.style.transitionDuration = durs[i] * 1.6 + 'ms';
        setTimeout(() => { seg.style.width = (durs[i] / total) * 100 + '%'; bar.style.width = '100%'; }, 60);
        setTimeout(() => {
          $$('.tile', tiles)[i].classList.add('done');
          rows.insertAdjacentHTML('beforeend', `<tr><td>${i + 1}</td><td><b>${esc(p[0])}</b><br><small>${esc(p[1])}</small></td><td>${esc(p[2])}</td></tr>`);
          $('#r-tok').textContent = fmt((rows.children.length) * 312) + ' tokens';
        }, durs[i] * 1.6 + 120);
      });
      const parTimer = setInterval(() => { const s = Math.min(maxDur * 1.6, performance.now() - t0); $('#r-par-t').textContent = (s / 1000 / 1.6 * 2.2).toFixed(1) + 's'; }, 60);
      await sleep(total * 1.6 + 2600);
      clearInterval(seqTimer); clearInterval(parTimer);
    }
  }
  root.addEventListener('inview', run, { once: true });
})();

// ---------- quick start ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('[data-qs-pane]').forEach((p) => (p.hidden = p.dataset.qsPane !== b.dataset.qs));
}));
$$('.copy').forEach((b) => b.addEventListener('click', async () => {
  const text = b.nextElementSibling.innerText.split('\n').filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('"')).join('\n').trim();
  await navigator.clipboard.writeText(text).catch(() => {});
  b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500);
}));
