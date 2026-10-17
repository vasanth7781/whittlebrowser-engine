// Tiny static server for website/dist (no dependencies).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
const root = join(import.meta.dirname, 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = +(process.env.PORT || 4321);
createServer(async (req, res) => {
  let p = join(root, decodeURIComponent((req.url || '/').split('?')[0]));
  if (p !== root && !p.startsWith(root + sep)) { res.writeHead(404); res.end('not found'); return; } // stay inside dist/
  try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); } catch { /* 404 below */ }
  try { res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`)); // this machine only
