// Serves test/fixtures on a fixed port so every MCP arm's browser can reach the same pages.
//   node bench/agent/fixtures-server.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');
const port = +(process.argv[2] || process.env.BENCH_PORT || 4399);
createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  const f = join(FIX, path === '/' ? 'shipping.html' : path);
  if (!f.startsWith(FIX) || !existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
  res.end(readFileSync(f));
}).listen(port, '127.0.0.1', () => console.error(`fixtures on http://127.0.0.1:${port}`));
