// Shared by the Cloud and Mac pages: scroll reveal, and the waitlist form.
const $ = (s, r = document) => r.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); e.target.dispatchEvent(new Event('inview')); }
}, { threshold: 0.18 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

const form = $('#waitlist');
if (form) {
  const msg = $('.wl-msg', form), button = $('button', form), input = form.elements.email;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'wl-msg';
    if (!input.checkValidity()) { msg.textContent = 'Enter a valid email address.'; msg.classList.add('err'); input.focus(); return; }
    button.disabled = true; button.textContent = 'Joining…';
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: input.value, interest: form.dataset.interest, company: form.elements.company.value }),
      });
      if (res.status === 400) {
        const { error } = await res.json().catch(() => ({}));
        msg.textContent = error === 'disposable_email' ? 'Please use a permanent email address. Temporary and disposable addresses are not accepted.' : 'That email address does not look right.';
        msg.classList.add('err'); button.disabled = false; button.textContent = 'Join the waitlist'; input.focus(); return;
      }
      if (!res.ok) throw new Error(String(res.status));
      form.replaceChildren();
      const done = document.createElement('p');
      done.className = 'wl-done'; done.setAttribute('role', 'status');
      done.textContent = `You're on the list. We'll write to ${input.value.trim()} when ${form.dataset.name} opens.`;
      form.append(done);
      burst(form);
    } catch {
      msg.textContent = 'Something went wrong. Please try again in a moment.'; msg.classList.add('err');
      button.disabled = false; button.textContent = 'Join the waitlist';
    }
  });
}

// A short burst of confetti over an element, for when someone joins the waitlist.
function burst(el) {
  if (reduce) return;
  const layer = document.createElement('div');
  layer.className = 'confetti'; layer.setAttribute('aria-hidden', 'true');
  const colors = ['#0a7d5a', '#6fd3ad', '#141414', '#e0b84a', '#8b93ff'];
  for (let i = 0; i < 34; i++) {
    const s = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 150;
    s.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 40}px;--r:${Math.random() * 540 - 270}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 90}ms`;
    layer.append(s);
  }
  el.style.position = 'relative'; el.append(layer);
  setTimeout(() => layer.remove(), 1500);
}

// Mac page: count the floating "tokens saved" chip up when it scrolls into view.
const chip = $('#mchip');
if (chip) $('#mac-visual').addEventListener('inview', () => {
  const to = +chip.dataset.to, t0 = performance.now();
  const tick = (t) => { const k = reduce ? 1 : Math.min(1, (t - t0) / 1800); chip.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, { once: true });

// Cloud page: the live-view handoff. The agent signs in, hits a 2FA prompt, a person types the code, the agent carries on.
(function handoff() {
  const root = $('#hdemo');
  if (!root) return;
  const page = $('#hpage'), feed = $('#hfeed'), banner = $('#hbanner');
  const cur = { a: $('#hcur-a'), u: $('#hcur-u') }, lab = { a: $('#hlab-a'), u: $('#hlab-u') };
  const cards = ['h-login', 'h-code', 'h-dash'].map((id) => $('#' + id));
  const show = (id) => cards.forEach((c) => c.classList.toggle('on', c.id === id));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rel = (el) => { const a = el.getBoundingClientRect(), b = page.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }; };
  const move = async (who, el, fx = 0.4) => {
    const r = rel(el), x = r.x + r.w * fx, y = r.y + r.h * 0.55;
    cur[who].style.transform = `translate(${x}px, ${y}px)`; lab[who].style.transform = `translate(${x + 18}px, ${y + 16}px)`;
    cur[who].classList.add('on'); lab[who].classList.add('on');
    await sleep(800);
  };
  const hide = (who) => { cur[who].classList.remove('on'); lab[who].classList.remove('on'); };
  const press = async (el) => { el.classList.add('press'); await sleep(220); el.classList.remove('press'); };
  const type = async (el, text, ms = 70) => { for (const ch of text) { el.textContent += ch; await sleep(ms); } };
  const log = (who, text, tok) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="${who}">${who}</span> ${esc(text)}${tok ? ` <em>${tok} tokens</em>` : ''}`;
    feed.append(li); while (feed.children.length > 5) feed.firstChild.remove();
  };
  const reset = () => {
    feed.innerHTML = ''; ['hf-email', 'hf-pw', 'hf-code'].forEach((id) => ($('#' + id).textContent = ''));
    banner.className = 'hbanner'; banner.textContent = 'Agent is waiting for you · 2FA code';
    hide('a'); hide('u'); show('h-login');
  };

  if (reduce) { show('h-code'); banner.classList.add('on'); log('agent', 'wait · page asks for a 2FA code'); return; }
  root.addEventListener('inview', async () => {
    for (;;) {
      reset(); await sleep(700);
      await move('a', $('#hf-email').parentElement); log('agent', 'type [email] ada@acme.com'); await type($('#hf-email'), 'ada@acme.com');
      await move('a', $('#hf-pw').parentElement); log('agent', 'type [password] secret:ACME_PW'); await type($('#hf-pw'), '••••••••', 45);
      await move('a', $('#h-signin'), 0.5); await press($('#h-signin'));
      show('h-code'); log('agent', 'wait · the page asks for a 2FA code'); banner.classList.add('on'); hide('a');
      await sleep(1300);
      await move('u', $('#hf-code').parentElement); log('you', 'typing the code from your phone'); await type($('#hf-code'), '482916', 150);
      await move('u', $('#h-verify'), 0.5); await press($('#h-verify'));
      banner.classList.add('ok'); banner.textContent = 'Thanks. The agent carries on.'; log('you', 'done');
      await sleep(900); hide('u'); banner.classList.remove('on'); show('h-dash');
      await move('a', $('#h-dash .hrow')); log('agent', 'extract table · 3 rows', '412'); await sleep(900);
      log('agent', 'done · 3 invoices read'); await sleep(3400);
    }
  }, { once: true });
})();
