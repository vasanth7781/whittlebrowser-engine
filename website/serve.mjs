// Tiny local server for website/dist (no dependencies). Mirrors production: /cloud serves cloud.html, and
// POST /api/waitlist saves signups to .data/waitlist.jsonl (git-ignored) instead of Cloudflare D1.
import { createServer } from 'node:http';
import { readFile, stat, appendFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { handleWaitlist } from './lib/waitlist.mjs';

const root = join(import.meta.dirname, 'dist');
const dataFile = join(import.meta.dirname, '.data', 'waitlist.jsonl');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = +(process.env.PORT || 4321);

const fileStore = {
  async add(email, interest, createdAt) {
    const seen = existsSync(dataFile) && readFileSync(dataFile, 'utf8').split('\n').some((l) => l && JSON.parse(l).email === email && JSON.parse(l).interest === interest);
    if (seen) return;
    await mkdir(join(import.meta.dirname, '.data'), { recursive: true });
    await appendFile(dataFile, JSON.stringify({ email, interest, created_at: createdAt }) + '\n');
  },
};

const isFile = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
const isDir = async (p) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/waitlist') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handleWaitlist(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), fileStore);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  let p = join(root, decodeURIComponent(url.pathname));
  if (p !== root && !p.startsWith(root + sep)) { res.writeHead(404); res.end('not found'); return; } // stay inside dist/
  if (await isDir(p)) p = join(p, 'index.html');
  else if (!(await isFile(p)) && await isFile(p + '.html')) p += '.html'; // /cloud -> cloud.html
  try { res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`)); // this machine only
