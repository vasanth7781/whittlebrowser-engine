// "What would you save" section: a dot race (1 dot = 1,000 tokens) and a calculator, both from docs/benchmark.json.
const $ = (s, r = document) => r.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const box = $('#savings-box');

const fmtUSD = (n) => '$' + (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2));
const fmtTok = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? Math.round(n / 1e6).toLocaleString('en-US') + 'M' : Math.round(n / 1e3).toLocaleString('en-US') + 'k');
const niceViews = (v) => { const x = 10 * Math.pow(1000, v / 100); const p = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.round(x / p) * p; };

function tween(el, to, fmt, ms = 450) {
  const from = el._v ?? 0, t0 = performance.now();
  if (reduce) { el._v = to; el.textContent = fmt(to); return; }
  cancelAnimationFrame(el._raf);
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el._v = from + (to - from) * e; el.textContent = fmt(el._v);
    if (k < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

fetch('data/bench.json').then((r) => r.json()).then((B) => {
  const pages = B.pages.length;
  const total = { pw: B.allin.pw.text + B.allin.pw.img + B.allin.pw.fixed, ab: B.allin.ours.text + B.allin.ours.img + B.allin.ours.fixed };
  const perView = { pw: total.pw / pages, ab: total.ab / pages };

  // dot race
  for (const k of ['pw', 'ab']) {
    const grid = $('#dots-' + k), n = Math.round(total[k] / 1000);
    grid.innerHTML = Array.from({ length: n }, (_, i) => `<i style="transition-delay:${reduce ? 0 : Math.min(i * 4, 1400)}ms"></i>`).join('');
  }
  box.addEventListener('inview', () => {
    box.classList.add('go');
    tween($('#sv-pw-k'), total.pw / 1000, (v) => Math.round(v) + 'k', 1500);
    tween($('#sv-ab-k'), total.ab / 1000, (v) => Math.round(v) + 'k', 1500);
  }, { once: true });

  // calculator
  const range = $('#sv-range'), prices = [...document.querySelectorAll('.sv-price button')];
  let price = 3;
  const update = () => {
    const views = niceViews(+range.value);
    $('#sv-views').textContent = views.toLocaleString('en-US');
    const tokens = { pw: views * 30 * perView.pw, ab: views * 30 * perView.ab };
    const usd = { pw: (tokens.pw / 1e6) * price, ab: (tokens.ab / 1e6) * price };
    tween($('#sv-pw-usd'), usd.pw, fmtUSD); tween($('#sv-ab-usd'), usd.ab, fmtUSD);
    $('#sv-pw-bar').style.width = '100%';
    $('#sv-ab-bar').style.width = Math.max(2, (usd.ab / usd.pw) * 100) + '%';
    tween($('#sv-save'), usd.pw - usd.ab, fmtUSD);
    $('#sv-save-tok').textContent = `${fmtTok(tokens.pw - tokens.ab)} fewer tokens read each month (${fmtTok(tokens.pw)} against ${fmtTok(tokens.ab)})`;
  };
  range.addEventListener('input', update);
  prices.forEach((b) => b.addEventListener('click', () => { price = +b.dataset.price; prices.forEach((x) => x.classList.toggle('on', x === b)); update(); }));
  update();
});
