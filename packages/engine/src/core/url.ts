/**
 * URLs are shown compactly: no scheme, no www, long query values elided. Query strings are a known
 * prompt-injection and token-leak vector (CometJacking), so their values never reach the model in full.
 */
export function compactUrl(raw: string, maxQuery = 40): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.slice(0, 120);
  }
  if (u.protocol === 'about:' || u.protocol === 'data:') return raw.slice(0, 40);
  let out = u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
  if (u.search) {
    if (u.search.length <= maxQuery) out += u.search;
    else out += '?' + [...u.searchParams.keys()].slice(0, 6).map((k) => `${k.slice(0, 20)}=…`).join('&');
  }
  if (u.hash && u.hash.length <= 30 && /^#[/!]/.test(u.hash)) out += u.hash;
  return out;
}

export function originOf(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin === 'null' ? u.protocol : u.origin;
  } catch {
    return '';
  }
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const SCHEMES = /^(https?|file|about|data|view-source|chrome|devtools|wbui|mailto|blob):/i;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(:\d+)?(\/|$|\?|#)/i;

/**
 * Address-bar text -> URL. "localhost:8000/x" and "192.168.1.5:3000" are hosts, not schemes;
 * local hosts get http://, other hosts https://, anything else becomes a search.
 */
export function toUrl(text: string, search = 'https://duckduckgo.com/?q=%s'): string {
  const s = text.trim();
  if (SCHEMES.test(s)) return s;
  if (LOCAL.test(s)) return 'http://' + s;
  if (/^[^\s/:]+(\.[^\s/:]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return 'https://' + s;
  return search.replace('%s', encodeURIComponent(s));
}
