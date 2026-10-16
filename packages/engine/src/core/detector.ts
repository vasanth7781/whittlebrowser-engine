/**
 * Sensitive-page detector (local, heuristic, default-deny). Decides whether AI may see/act on a page.
 *   ok      -> normal
 *   caution -> AI allowed, field values masked, typing only via secret refs/tokens is recommended
 *   pause   -> AI switched off for this page until the user overrides (shell: AI dot; MCP: --allow-site)
 */
import type { PageSignals } from './types.js';
import { hostOf } from './url.js';

export type Level = 'ok' | 'caution' | 'pause';
export interface Assessment {
  level: Level;
  reasons: string[];
}

const BANKS = [
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'usbank.com', 'pnc.com', 'capitalone.com',
  'americanexpress.com', 'discover.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'etrade.com', 'robinhood.com',
  'hsbc.com', 'hsbc.co.uk', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com', 'santander.com', 'santander.co.uk',
  'monzo.com', 'revolut.com', 'wise.com', 'n26.com', 'paypal.com', 'venmo.com', 'coinbase.com', 'kraken.com', 'binance.com',
  'icicibank.com', 'hdfcbank.com', 'onlinesbi.sbi', 'sbi.co.in', 'axisbank.com', 'kotak.com', 'yesbank.in', 'paytm.com',
  'rbcroyalbank.com', 'td.com', 'scotiabank.com', 'bmo.com', 'commbank.com.au', 'westpac.com.au', 'anz.com', 'nab.com.au',
  'dbs.com.sg', 'ocbc.com', 'uob.com.sg', 'ing.com', 'bnpparibas', 'deutsche-bank.de', 'commerzbank.de',
];
const CONSOLES: [RegExp, string][] = [
  [/^(.+\.)?console\.aws\.amazon\.com$|^signin\.aws\.amazon\.com$/, 'AWS console'],
  [/^portal\.azure\.com$|^entra\.microsoft\.com$/, 'Azure portal'],
  [/^console\.cloud\.google\.com$|^admin\.google\.com$/, 'Google Cloud/Admin console'],
  [/^dashboard\.stripe\.com$/, 'Stripe dashboard'],
  [/^(cloud\.)?digitalocean\.com$|^dash\.cloudflare\.com$|^vercel\.com$|^app\.netlify\.com$|^dashboard\.heroku\.com$/, 'hosting console'],
  [/^(platform\.openai\.com|console\.anthropic\.com|aistudio\.google\.com)$/, 'AI provider console'],
  [/^(my\.)?1password\.(com|eu|ca)$|^vault\.bitwarden\.com$|^lastpass\.com$|^app\.dashlane\.com$/, 'password manager'],
];
const KEY_PATHS: [RegExp, RegExp, string][] = [
  [/^github\.com$/, /^\/settings\/(tokens|keys|security|apps)/, 'GitHub credentials page'],
  [/^gitlab\.com$/, /^\/-\/user_settings\/(personal_access_tokens|ssh_keys)/, 'GitLab credentials page'],
  [/.*/, /\/(api[-_]?keys?|tokens?|credentials|secrets)(\/|$)/i, 'API key page'],
];

export interface DetectorOptions {
  /** Hosts the user explicitly allowed (overrides pause). */
  allow?: string[];
}

export function assess(url: string, s: PageSignals | null, opts: DetectorOptions = {}): Assessment {
  const host = hostOf(url);
  const reasons: string[] = [];
  let level = 'ok' as Level;
  const pause = (r: string) => { reasons.push(r); level = 'pause'; };
  const caution = (r: string) => { reasons.push(r); if (level === 'ok') level = 'caution'; };

  if (host) {
    if (BANKS.some((b) => host === b || host.endsWith('.' + b)) || /\.bank$/.test(host)) pause('banking/finance domain');
    for (const [re, label] of CONSOLES) if (re.test(host)) pause(label);
    let path = '';
    try { path = new URL(url).pathname; } catch { /* ignore */ }
    for (const [h, p, label] of KEY_PATHS) if (h.test(host) && p.test(path)) pause(label);
  }
  if (s) {
    if (s.card) pause(`payment card field${s.card > 1 ? 's' : ''}`);
    if (s.secretField) pause('API key/secret field');
    if (s.idField) pause('government ID field');
    if (s.otp) caution('one-time code field');
    if (s.password) caution('password field');
    if (s.challenge) caution(`bot challenge (${s.challenge}): hand off to the user`);
  }
  if (level === 'pause' && host && opts.allow?.some((a) => host === a || host.endsWith('.' + a))) {
    level = 'caution';
    reasons.push('allowed by user');
  }
  return { level, reasons };
}
