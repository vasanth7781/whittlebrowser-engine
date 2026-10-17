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
  /** Attach to an existing browser (e.g. a host app such as the desktop browser) instead of launching. */
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

/**
 * Runs `start` with the bundled Chromium. If it was never downloaded, tries the Google Chrome installed on this
 * machine, and if that is missing too, says exactly what to run instead of showing Playwright's path error.
 */
/** @internal exported for tests */
export async function withBrowser<T>(channel: string | undefined, start: (channel: string | undefined) => Promise<T>): Promise<T> {
  try {
    return await start(channel);
  } catch (e) {
    if (channel || !/Executable doesn't exist/i.test((e as Error).message)) throw e;
    try {
      return await start('chrome');
    } catch {
      throw new Error('No browser to drive. Run `npx playwright-core install chromium` once (or install Google Chrome), then try again.');
    }
  }
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
      browser = await withBrowser(o.channel, (channel) => chromium.launch({ headless: o.headless ?? false, channel, args }));
      context = await browser.newContext({ viewport, acceptDownloads: true });
    } else {
      const dir = o.profileDir ?? join(homedir(), '.whittlebrowser', 'profile');
      context = await withBrowser(o.channel, (channel) => chromium.launchPersistentContext(dir, { headless: o.headless ?? false, channel, viewport, args, acceptDownloads: true }));
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
      if (o.cdpUrl) await browser?.close().catch(() => {}); // disconnects; the host keeps running
      else {
        await context.close().catch(() => {});
        await browser?.close().catch(() => {});
      }
    },
  };
}
