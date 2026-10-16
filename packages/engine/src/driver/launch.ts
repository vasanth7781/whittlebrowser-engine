/** Start or attach to a browser. Real Chromium + a persistent profile: a genuine fingerprint, nothing spoofed. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { loadBotKey, signRequest } from '../core/webbotauth.js';

export interface LaunchOptions {
  headless?: boolean;
  /** Persistent profile directory. Default ~/.whittlebrowser/profile. Use null for an ephemeral profile. */
  profileDir?: string | null;
  /** Attach to an existing browser (e.g. the WhittleBrowser shell) instead of launching. */
  cdpUrl?: string;
  /** 'chrome' to drive the installed Google Chrome instead of bundled Chromium. */
  channel?: string;
  viewport?: { width: number; height: number };
  /** Web Bot Auth: PEM file with an Ed25519 key and the URL hosting its key directory. */
  botAuth?: { keyFile: string; agentUrl: string };
}

export interface Launched {
  context: BrowserContext;
  browser: Browser | null;
  close(): Promise<void>;
}

export async function launch(o: LaunchOptions = {}): Promise<Launched> {
  let context: BrowserContext;
  let browser: Browser | null = null;
  if (o.cdpUrl) {
    browser = await chromium.connectOverCDP(o.cdpUrl);
    context = browser.contexts()[0] || (await browser.newContext());
  } else {
    const viewport = o.viewport ?? { width: 1280, height: 860 };
    const args = ['--no-first-run', '--no-default-browser-check'];
    if (o.profileDir === null) {
      browser = await chromium.launch({ headless: o.headless ?? false, channel: o.channel, args });
      context = await browser.newContext({ viewport, acceptDownloads: true });
    } else {
      const dir = o.profileDir ?? join(homedir(), '.whittlebrowser', 'profile');
      context = await chromium.launchPersistentContext(dir, { headless: o.headless ?? false, channel: o.channel, viewport, args, acceptDownloads: true });
    }
  }
  if (o.botAuth) {
    const key = loadBotKey(readFileSync(o.botAuth.keyFile, 'utf8'));
    const agentUrl = o.botAuth.agentUrl;
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (!/^https?:/.test(url)) return route.continue();
      return route.continue({ headers: { ...route.request().headers(), ...signRequest(url, key, agentUrl) } });
    });
  }
  return {
    context,
    browser,
    async close() {
      if (o.cdpUrl) await browser?.close().catch(() => {}); // disconnects; the shell keeps running
      else {
        await context.close().catch(() => {});
        await browser?.close().catch(() => {});
      }
    },
  };
}
