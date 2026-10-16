import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, type Launched } from '../src/driver/launch.js';
import { Session, type SessionOptions } from '../src/driver/session.js';
import { StaticPolicy, type StaticPolicyOptions } from '../src/driver/policy.js';
import { Privacy } from '../src/core/privacy.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export async function serve(): Promise<{ url: (p: string) => string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nDisallow: /private\n'); return; }
    const f = join(FIX, path === '/' ? 'shipping.html' : path);
    if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: (p) => `http://127.0.0.1:${port}/${p}`, close: () => new Promise((r) => server.close(() => r())) };
}

export async function start(policy: StaticPolicyOptions = {}, opts: SessionOptions = {}, vault?: Record<string, string>): Promise<{ s: Session; b: Launched }> {
  const b = await launch({ headless: true, profileDir: null });
  const s = new Session(b.context, new StaticPolicy(policy), { identify: false, robots: 'off', ...opts }, new Privacy({ vault }));
  return { s, b };
}
