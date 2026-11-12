// Effects shared by every page: scroll progress bar, pointer glow, and a gentle 3D tilt. All are skipped for reduced motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const bar = document.createElement('div');
bar.className = 'progress';
bar.setAttribute('aria-hidden', 'true');
document.body.prepend(bar);
const root = document.documentElement;
const progress = () => { const max = root.scrollHeight - root.clientHeight; bar.style.transform = `scaleX(${max > 0 ? Math.min(1, root.scrollTop / max) : 0})`; };
addEventListener('scroll', progress, { passive: true });
addEventListener('resize', progress);
progress();

if (!reduce) {
  document.querySelectorAll('.glow-zone, .product').forEach((el) => el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  const tilts = [...document.querySelectorAll('[data-tilt]')];
  if (tilts.length) {
    let raf = 0, px = 0, py = 0;
    const apply = () => {
      raf = 0;
      for (const el of tilts) {
        const r = el.getBoundingClientRect();
        const dx = (px - (r.left + r.width / 2)) / innerWidth, dy = (py - (r.top + r.height / 2)) / innerHeight;
        el.style.setProperty('--ry', `${Math.max(-1, Math.min(1, dx * 2)) * 4}deg`);
        el.style.setProperty('--rx', `${Math.max(-1, Math.min(1, dy * 2)) * -3}deg`);
      }
    };
    addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    document.addEventListener('pointerleave', () => tilts.forEach((el) => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }));
  }
}
