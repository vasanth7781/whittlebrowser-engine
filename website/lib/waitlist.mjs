// Waitlist signup handler. Runtime-neutral: it takes a Request and a store and returns a Response, so the same code
// runs as a Cloudflare Pages Function (functions/api/waitlist.js) and in the local dev server (serve.mjs).
//
// A store is { add(email, interest, createdAt) } and resolves when the row is saved or already there.
// We keep the email, which list it is for, and the time. No IP address and no user agent.

import { DISPOSABLE_DOMAINS } from './disposable-domains.mjs';

export const INTERESTS = ['cloud', 'mac'];
const MAX_BODY = 2048;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const DISPOSABLE = new Set(DISPOSABLE_DOMAINS);

// True when the address is on a temporary / disposable email service. A listed domain also blocks its subdomains,
// so x@mail.mailinator.com is caught by mailinator.com, while notmailinator.com is not.
export function isDisposable(email) {
  const labels = email.slice(email.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 0; i < labels.length - 1; i++) if (DISPOSABLE.has(labels.slice(i).join('.'))) return true;
  return false;
}

export async function handleWaitlist(request, store, now = () => new Date()) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // Browsers send Origin on cross-site posts. Refuse any that is not this site.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { ok: false, error: 'forbidden' });

  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, error: 'too_large' });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: 'bad_request' }); }
  if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'bad_request' });

  // Hidden field that people never fill in. A bot that does gets the same answer as a real signup and nothing is stored.
  if (body.company) return json(200, { ok: true });

  const email = normalizeEmail(body.email);
  if (!email) return json(400, { ok: false, error: 'invalid_email' });
  if (isDisposable(email)) return json(400, { ok: false, error: 'disposable_email' });
  const interest = body.interest ?? 'cloud';
  if (!INTERESTS.includes(interest)) return json(400, { ok: false, error: 'invalid_interest' });

  try { await store.add(email, interest, now().toISOString()); } catch { return json(500, { ok: false, error: 'storage_failed' }); }
  // Same answer whether or not the address was already on the list, so the form can't be used to check who signed up.
  return json(200, { ok: true });
}
