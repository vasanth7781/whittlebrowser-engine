// Benchmark charts (vanilla SVG). Emphasis encoding: WhittleBrowser in the brand green, other tools in
// one gray and told apart by marker shape (square, triangle, diamond) plus a legend; values are direct-
// labelled where they matter and every chart has a table twin. Data: bench/results/latest.json.
const NS = 'http://www.w3.org/2000/svg';
const GREEN = '#0A7D5A', GRAY = '#A8A39A', INK = '#141414', MUTED = '#67645e', LINE = '#e5e1d9';
const TOOLS = [
  { key: 'pw', name: 'Playwright MCP', shape: 'square' },
  { key: 'bu', name: 'browser-use', shape: 'triangle' },
  { key: 'sh', name: 'Stagehand', shape: 'diamond' },
  { key: 'ours', name: 'WhittleBrowser', shape: 'circle' },
];
const fmt = (n) => (n == null ? 'n/a' : Math.round(n).toLocaleString('en-US'));
const short = (n) => (n >= 1e5 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };

let tip;
function tooltip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'chart-tip';
  document.body.appendChild(tip);
  return tip;
}
function bindTip(target, html) {
  const t = tooltip();
  const show = (e) => { t.innerHTML = html; t.style.opacity = 1; move(e); };
  const move = (e) => { const r = t.getBoundingClientRect(); t.style.left = Math.min(innerWidth - r.width - 12, (e.clientX ?? 0) + 14) + 'px'; t.style.top = Math.max(8, (e.clientY ?? 0) - r.height - 12) + 'px'; };
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerleave', () => (t.style.opacity = 0));
  target.addEventListener('focus', (e) => { const b = target.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); });
  target.addEventListener('blur', () => (t.style.opacity = 0));
  target.setAttribute('tabindex', '0');
}
function marker(g, shape, x, y, r, fill, stroke = '#fff') {
  const a = { fill, stroke, 'stroke-width': 2 };
  if (shape === 'circle') return el('circle', { cx: x, cy: y, r: r + 1, ...a }, g);
  if (shape === 'square') return el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, rx: 1.5, ...a }, g);
  if (shape === 'triangle') return el('path', { d: `M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z`, ...a }, g);
  return el('path', { d: `M${x} ${y - r - 1.5}L${x + r + 1.5} ${y}L${x} ${y + r + 1.5}L${x - r - 1.5} ${y}Z`, ...a }, g);
}
function placeLegend(fig, l) {
  const plot = fig.querySelector('.chart-plot');
  plot ? fig.insertBefore(l, plot) : fig.prepend(l);
}
function legend(fig, items) {
  const l = document.createElement('div');
  l.className = 'chart-legend';
  l.innerHTML = items.map((i) => `<span><svg width="14" height="14" viewBox="-7 -7 14 14">${i.svg}</svg>${i.label}</span>`).join('');
  placeLegend(fig, l);
}
const shapeSvg = (shape, fill) => {
  const d = document.createElementNS(NS, 'svg');
  marker(d, shape, 0, 0, 4.5, fill, 'none');
  return d.innerHTML;
};
function table(fig, head, rows) {
  const d = document.createElement('details');
  d.className = 'chart-table';
  d.innerHTML = `<summary>Show the numbers</summary><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  fig.appendChild(d);
}

// ---------- dot plot: one row per item, one marker per tool, log or linear x ----------
function dotPlot(fig, items, { log = false, unit = 'tokens' } = {}) {
  const host = fig.querySelector('.chart-plot') || fig.appendChild(Object.assign(document.createElement('div'), { className: 'chart-plot' }));
  const W = Math.max(320, host.clientWidth || fig.clientWidth || 720);
  const narrow = W < 560;
  const labelW = narrow ? 34 : Math.min(250, Math.max(150, ...items.map((i) => i.name.length * 7.2 + 16))), right = narrow ? 16 : 40, rowH = narrow ? 46 : 34, top = 8, axisH = 26;
  const H = top + items.length * rowH + axisH;
  const vals = items.flatMap((it) => TOOLS.map((t) => it[t.key]).filter((v) => v > 0));
  const max = Math.max(...vals), min = Math.min(...vals);
  const lo = log ? Math.pow(10, Math.floor(Math.log10(min))) : 0;
  const hi = log ? max * 1.6 : max * 1.08;
  const x = (v) => labelW + (log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : v / hi) * (W - labelW - right);
  host.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': fig.dataset.title || 'chart' }, host);
  const ticks = log ? Array.from({ length: Math.ceil(Math.log10(hi / lo)) + 1 }, (_, i) => lo * Math.pow(10, i)).filter((t) => t <= hi) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((hi * f) / 1000) * 1000);
  for (const tv of ticks) {
    const tx = x(Math.max(tv, log ? lo : 0));
    el('line', { x1: tx, x2: tx, y1: top - 4, y2: H - axisH + 2, stroke: LINE, 'stroke-width': 1 }, svg);
    el('text', { x: tx, y: H - 8, 'text-anchor': 'middle', class: 'chart-axis' }, svg).textContent = short(tv);
  }
  items.forEach((it, i) => {
    const cy = top + i * rowH + rowH / 2 + (narrow ? 7 : 0);
    const g = el('g', { class: 'chart-row' }, svg);
    const maxChars = narrow ? 44 : Math.floor((labelW - 12) / 7.2);
    const name = it.name.length > maxChars ? it.name.slice(0, maxChars - 1) + '…' : it.name;
    el('text', narrow ? { x: 0, y: cy - 12, class: 'chart-label' } : { x: 0, y: cy + 4, class: 'chart-label' }, g).textContent = name;
    const present = TOOLS.filter((t) => it[t.key] > 0);
    const xs = present.map((t) => x(it[t.key]));
    el('line', { x1: Math.min(...xs), x2: Math.max(...xs), y1: cy, y2: cy, stroke: LINE, 'stroke-width': 2 }, g);
    for (const t of present) if (t.key !== 'ours') marker(g, t.shape, x(it[t.key]), cy, 4.5, GRAY);
    marker(g, 'circle', x(it.ours), cy, 5.5, GREEN);
    el('text', { x: x(it.ours) - 10, y: cy + 4, 'text-anchor': 'end', class: 'chart-value' }, g).textContent = short(it.ours);
    const hit = el('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent' }, g);
    bindTip(hit, `<b>${it.name}</b>${TOOLS.map((t) => `<div><span>${t.name}</span><b${t.key === 'ours' ? ' class="g"' : ''}>${fmt(it[t.key])}</b></div>`).join('')}<small>${unit}</small>`);
  });
}

// ---------- stacked horizontal bars: all-in cost per tool ----------
function stackBars(fig, data) {
  const host = fig.querySelector('.chart-plot') || fig.appendChild(Object.assign(document.createElement('div'), { className: 'chart-plot' }));
  const W = Math.max(320, host.clientWidth || fig.clientWidth || 720);
  const narrow = W < 560;
  const labelW = narrow ? 0 : 150, right = narrow ? 112 : 170, rowH = narrow ? 64 : 46, barH = 18, axisH = 24;
  const rows = TOOLS.filter((t) => data[t.key]).map((t) => ({ ...t, ...data[t.key], total: data[t.key].text + data[t.key].img + data[t.key].fixed }));
  const max = Math.max(...rows.map((r) => r.total));
  const H = rows.length * rowH + axisH;
  const x = (v) => (v / max) * (W - labelW - right);
  host.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': fig.dataset.title || 'chart' }, host);
  const ticks = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => max * f);
  for (const tv of ticks) {
    const tx = labelW + x(tv);
    el('line', { x1: tx, x2: tx, y1: 0, y2: H - axisH + 2, stroke: LINE }, svg);
    el('text', { x: tx, y: H - 6, 'text-anchor': tv === 0 ? 'start' : 'middle', class: 'chart-axis' }, svg).textContent = short(tv);
  }
  const ours = rows.find((r) => r.key === 'ours');
  rows.forEach((r, i) => {
    const cy = i * rowH + rowH / 2 - 4 + (narrow ? 8 : 0);
    const us = r.key === 'ours';
    const shades = us ? [GREEN, '#5FAE8F', '#A9D3C1'] : ['#8F8A81', '#B7B2A9', '#D6D1C8'];
    const g = el('g', {}, svg);
    el('text', narrow ? { x: 0, y: cy - barH / 2 - 7, class: 'chart-label' + (us ? ' us' : '') } : { x: 0, y: cy + 4, class: 'chart-label' + (us ? ' us' : '') }, g).textContent = r.name;
    let cx = labelW;
    [['page text', r.text], ['screenshots', r.img], ['fixed overhead', r.fixed]].forEach(([, v], j) => {
      if (!v) return;
      const w = Math.max(2, x(v) - 2);
      const seg = el('rect', { x: cx, y: cy - barH / 2, width: w, height: barH, rx: 5, fill: shades[j] }, g);
      seg.style.transformOrigin = `${labelW}px ${cy}px`;
      cx += w + 2;
    });
    el('text', { x: cx + 8, y: cy + 4, class: 'chart-value' + (us ? ' us' : '') }, g).textContent = fmt(r.total);
    if (!us && ours) el('text', { x: cx + 8, y: cy + 19, class: 'chart-sub' }, g).textContent = `${narrow ? 'ours ' : 'WhittleBrowser '}−${Math.round((1 - ours.total / r.total) * 100)}%`;
    const hit = el('rect', { x: 0, y: cy - rowH / 2 + 4, width: W, height: rowH - 4, fill: 'transparent' }, g);
    bindTip(hit, `<b>${r.name}</b><div><span>page text</span><b>${fmt(r.text)}</b></div><div><span>screenshots</span><b>${fmt(r.img)}</b></div><div><span>fixed overhead</span><b>${fmt(r.fixed)}</b></div><div class="t"><span>all-in</span><b${us ? ' class="g"' : ''}>${fmt(r.total)}</b></div>`);
  });
  const l = document.createElement('div');
  l.className = 'chart-legend';
  l.innerHTML = ['page text', 'screenshots', 'fixed overhead (tool defs, system prompt, schema)'].map((n, j) => `<span><i style="background:${['#8F8A81', '#B7B2A9', '#D6D1C8'][j]}"></i><i style="background:${[GREEN, '#5FAE8F', '#A9D3C1'][j]};margin-left:-2px"></i>${n}</span>`).join('');
  placeLegend(fig, l);
}

// ---------- safety: dot matrix (filled = reached the model) ----------
function dotMatrix(fig, safety) {
  const host = fig.querySelector('.chart-plot') || fig.appendChild(Object.assign(document.createElement('div'), { className: 'chart-plot' }));
  host.innerHTML = '';
  const checks = [['secrets', 'Planted secrets reaching the model'], ['hidden', 'Hidden prompt injections reaching the model']];
  host.innerHTML = checks.map(([k, label]) => {
    const c = safety[k];
    return `<div class="dm"><div class="dm-h">${label}</div>${TOOLS.map((t) => {
      const n = c[t.key];
      const dots = Array.from({ length: c.total }, (_, i) => `<i class="${n == null ? 'na' : i < n ? 'on' : ''}${t.key === 'ours' ? ' us' : ''}"></i>`).join('');
      return `<div class="dm-row${t.key === 'ours' ? ' us' : ''}"><span>${t.name}</span><span class="dots">${dots}</span><b>${n == null ? 'n/a' : `${n} of ${c.total}`}</b></div>`;
    }).join('')}</div>`;
  }).join('');
  const l = document.createElement('div');
  l.className = 'chart-legend';
  l.innerHTML = `<span><i class="dm-key on"></i>reached the model</span><span><i class="dm-key"></i>blocked</span>`;
  placeLegend(fig, l);
}

// ---------- boot ----------
const charts = [...document.querySelectorAll('figure.chart[data-chart]')];
if (charts.length) {
  const src = charts[0].dataset.src || 'data/bench.json';
  fetch(src).then((r) => r.json()).then((B) => {
    const draw = () => {
      for (const fig of charts) {
        fig.querySelectorAll('.chart-legend,.chart-table').forEach((n) => n.remove());
        const kind = fig.dataset.chart;
        if (kind === 'pages') {
          dotPlot(fig, B.pages, { log: true });
          legend(fig, TOOLS.map((t) => ({ label: t.name, svg: shapeSvg(t.shape, t.key === 'ours' ? GREEN : GRAY) })));
          table(fig, ['Page', ...TOOLS.map((t) => t.name)], B.pages.map((p) => [p.name, ...TOOLS.map((t) => fmt(p[t.key]))]));
        } else if (kind === 'tasks') {
          dotPlot(fig, B.tasks, { log: false });
          legend(fig, TOOLS.map((t) => ({ label: t.name, svg: shapeSvg(t.shape, t.key === 'ours' ? GREEN : GRAY) })));
          table(fig, ['Task', 'Steps', ...TOOLS.map((t) => t.name)], B.tasks.map((p) => [p.name, p.steps, ...TOOLS.map((t) => fmt(p[t.key]))]));
        } else if (kind === 'allin') {
          stackBars(fig, B.allin);
          table(fig, ['Tool', 'Page text', 'Screenshots', 'Fixed overhead', 'All-in'], TOOLS.filter((t) => B.allin[t.key]).map((t) => { const a = B.allin[t.key]; return [t.name, fmt(a.text), fmt(a.img), fmt(a.fixed), fmt(a.text + a.img + a.fixed)]; }));
        } else if (kind === 'safety') {
          dotMatrix(fig, B.safety);
        }
        const cap = fig.querySelector('.chart-date');
        if (cap) cap.textContent = `Measured ${B.date} · ${B.tokenizer} tokens · browser-use ${B.versions.browserUse} · Stagehand ${B.versions.stagehand}`;
      }
    };
    draw();
    let rt;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(draw, 150); });
  }).catch(() => charts.forEach((f) => (f.querySelector('.chart-plot') || f).insertAdjacentHTML('beforeend', '<p class="chart-err">Benchmark data unavailable.</p>')));
}
