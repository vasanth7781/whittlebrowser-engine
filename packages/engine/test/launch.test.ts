import { describe, it, expect } from 'vitest';
import { withBrowser } from '../src/driver/launch.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('launch without a downloaded Chromium', () => {
  it('uses the installed Chrome, or says exactly what to run', () => {
    const out = execFileSync(join(here, '../node_modules/.bin/tsx'), [join(here, 'launch-fallback.script.ts')], {
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: mkdtempSync(join(tmpdir(), 'wb-nobrowser-')) },
      timeout: 60_000,
    });
    if (out.includes('LAUNCHED')) return; // this machine has Chrome
    expect(out).toContain('npx playwright-core install chromium');
    expect(out).not.toContain("Executable doesn't exist");
  });
});

describe('withBrowser', () => {
  const missing = () => Promise.reject(new Error("browserType.launch: Executable doesn't exist at /x/chromium"));
  it('falls back to Chrome when Chromium was never downloaded', async () => {
    const seen: (string | undefined)[] = [];
    const v = await withBrowser(undefined, async (c) => { seen.push(c); if (!c) return missing(); return 'ok'; });
    expect(v).toBe('ok');
    expect(seen).toEqual([undefined, 'chrome']);
  });
  it('tells the user what to run when there is no browser at all', async () => {
    await expect(withBrowser(undefined, () => missing())).rejects.toThrow(/npx playwright-core install chromium/);
  });
  it('does not second-guess an explicit channel or an unrelated error', async () => {
    await expect(withBrowser('msedge', () => missing())).rejects.toThrow(/Executable doesn't exist/);
    await expect(withBrowser(undefined, () => Promise.reject(new Error('profile is locked')))).rejects.toThrow('profile is locked');
  });
});
