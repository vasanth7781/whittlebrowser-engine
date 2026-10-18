// Injects theme.css (plus a few page-specific rules) into each fixture as <style data-theme>. Idempotent: run it after editing theme.css.
// The block goes first in <head>, so a fixture's own <style> (deliberate hidden text, overlays) is applied after it and still wins.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(join(here, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim();

const panel = 'main{background:#fff;border:1px solid var(--line);border-radius:18px;padding:30px 34px;box-shadow:0 1px 2px rgba(20,24,20,.04),0 18px 40px -22px rgba(20,24,20,.22)}';
const formUi = `
form{display:grid;gap:14px;margin-top:20px}
form>label{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--mute)}
form>label[for]{margin-bottom:-8px}
form>div{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
form>div label{font-weight:500;margin-right:14px}
form>p{margin:2px 0;color:var(--mute);font-size:13px}
form button{height:46px;border-radius:12px;font-size:15px;margin-top:4px}
.fancy{justify-self:start}
form>label.fancy span{padding:7px 16px;border:1px solid #d6d1c6;border-radius:999px;background:#fff;font-weight:500;font-size:14px;color:var(--ink)}`;

const extra = {
  'shipping.html': panel + formUi + `h1::before{content:"STEP 1 OF 3";display:block;margin-bottom:8px;font-weight:700;font-size:11px;line-height:1;font-family:inherit;letter-spacing:.12em;color:var(--brand)}`,
  'review.html': panel + `
main>button{margin:6px 10px 0 0}
main>button+button{background:#fff;color:var(--warn);border:1px solid #f0c6c1}
main>p:first-of-type{font-size:22px;font-weight:700;margin:14px 0 4px}
#done{margin-top:18px;padding:12px 14px;border-radius:10px;background:#e7f6ef;color:var(--ok);font-weight:600}
h1::before{content:"STEP 3 OF 3";display:block;margin-bottom:8px;font-weight:700;font-size:11px;line-height:1;font-family:inherit;letter-spacing:.12em;color:var(--brand)}`,
  'card.html': panel + formUi + `h1::before{content:"SECURE CHECKOUT";display:block;margin-bottom:8px;font-weight:700;font-size:11px;line-height:1;font-family:inherit;letter-spacing:.12em;color:var(--ok)}`,
  'perm.html': 'body{padding:40px 24px}body>*{max-width:560px;margin-left:auto;margin-right:auto}h1{margin-bottom:14px}',
  'turnstile.html': panel + formUi,
  'canary.html': panel + 'main>p{padding:10px 14px;background:#faf8f4;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;font-size:14px}main>label{display:block;margin:12px 0 6px;font-weight:600;font-size:13px;color:var(--mute)}main>button{margin-top:14px}',
  'results.html': `h1{font-size:24px;margin-bottom:16px}
.results{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.r{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 20px;transition:border-color .15s,box-shadow .15s}
.r:hover{border-color:#b9dccb;box-shadow:0 10px 24px -16px rgba(10,125,90,.45)}
.r a{text-decoration:none}.r h3{color:var(--brand);margin-bottom:3px}.r p{margin:0;color:var(--mute)}`,
  'table.html': `h1{margin-bottom:16px}
#cards{list-style:none;margin:0 0 28px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px}
.card::before{content:"";height:74px;border-radius:10px;background:linear-gradient(135deg,#e3f1ea,#c2e0d1 60%,#9fcfb5)}
.card a{text-decoration:none;color:var(--ink)}.card h3{font-size:15px}
.price{font-weight:700}.rating{font-size:12.5px;color:#a8670b}
.card button{height:34px;font-size:13px;margin-top:2px}
#t{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:14px}
#t caption{text-align:left;font-weight:700;font-size:18px;padding:0 0 10px}
#t th{background:#f7f5f0;color:var(--mute);text-align:left;font-weight:600;font-size:12.5px;letter-spacing:.03em;text-transform:uppercase}
#t th,#t td{padding:10px 14px;border-bottom:1px solid var(--line)}#t tbody tr:nth-child(even) td{background:#faf8f4}`,
  'article.html': `body>nav a{font-weight:600}
main{max-width:780px}
article{background:#fff;border:1px solid var(--line);border-radius:18px;padding:40px 48px;box-shadow:0 1px 2px rgba(20,24,20,.04),0 18px 40px -26px rgba(20,24,20,.22)}
article h1{font-family:Charter,Georgia,serif;font-size:38px;line-height:1.12;margin-bottom:4px}
article h1::after{content:"Food · 12 min read";display:block;margin-top:12px;font:500 13px/1 -apple-system,Segoe UI,sans-serif;color:var(--mute)}
article h2{font-family:Charter,Georgia,serif;margin-top:28px}
article p{font-family:Charter,Georgia,serif;font-size:17px;line-height:1.75;color:#2a2a2a}
article ul{color:#2a2a2a;line-height:1.8}`,
  'injection.html': `html{background:#fff}
main{max-width:680px;margin-top:40px;border:1px solid var(--line);border-radius:18px;padding:30px 34px;box-shadow:0 1px 2px rgba(20,24,20,.04),0 18px 40px -26px rgba(20,24,20,.25)}
main::before{content:"RECIPE";display:block;margin-bottom:10px;font:700 11px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.12em;color:var(--brand)}
main>button{margin-top:16px}`,
};

for (const [file, css] of Object.entries(extra)) {
  const p = join(here, file);
  let html = readFileSync(p, 'utf8');
  const block = `<style data-theme>\n${base}\n${css}\n</style>`;
  html = html.replace(/<style data-theme>[\s\S]*?<\/style>\n?/, '');
  html = /<head>/i.test(html) ? html.replace(/<head>/i, `<head>\n${block}\n`) : html.replace(/<html[^>]*>/i, (m) => `${m}<head>\n${block}\n</head>`);
  writeFileSync(p, html);
}
console.log('themed', Object.keys(extra).length, 'fixtures');
