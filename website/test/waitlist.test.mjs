import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWaitlist, normalizeEmail, isDisposable } from '../lib/waitlist.mjs';
import { DISPOSABLE_DOMAINS } from '../lib/disposable-domains.mjs';

const URL_ = 'https://whittlebrowser.app/api/waitlist';
const memory = () => { const rows = []; return { rows, add: async (email, interest, at) => { if (!rows.some((r) => r.email === email && r.interest === interest)) rows.push({ email, interest, at }); } }; };
const post = (body, headers = {}, method = 'POST') => new Request(URL_, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const fixed = () => new Date('2026-10-18T12:00:00Z');

test('stores a valid signup, lowercased and trimmed', async () => {
  const s = memory();
  const res = await handleWaitlist(post({ email: '  Ada@Example.COM ', interest: 'cloud' }), s, fixed);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(s.rows, [{ email: 'ada@example.com', interest: 'cloud', at: '2026-10-18T12:00:00.000Z' }]);
});

test('defaults to the cloud list', async () => {
  const s = memory();
  await handleWaitlist(post({ email: 'a@b.co' }), s);
  assert.equal(s.rows[0].interest, 'cloud');
});

test('a repeat signup gives the same answer and is stored once', async () => {
  const s = memory();
  const a = await handleWaitlist(post({ email: 'a@b.co' }), s);
  const b = await handleWaitlist(post({ email: 'a@b.co' }), s);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(s.rows.length, 1);
});

test('rejects bad emails and unknown lists', async () => {
  const s = memory();
  for (const email of ['', 'nope', 'a@b', 'a b@c.com', 42, null, 'x'.repeat(250) + '@b.co']) {
    assert.equal((await handleWaitlist(post({ email }), s)).status, 400, String(email));
  }
  assert.equal((await handleWaitlist(post({ email: 'a@b.co', interest: 'admin' }), s)).status, 400);
  assert.equal(s.rows.length, 0);
});

test('the honeypot field looks like success and stores nothing', async () => {
  const s = memory();
  const res = await handleWaitlist(post({ email: 'bot@b.co', company: 'Acme' }), s);
  assert.equal(res.status, 200);
  assert.equal(s.rows.length, 0);
});

test('refuses posts from another site, allows this site', async () => {
  const s = memory();
  assert.equal((await handleWaitlist(post({ email: 'a@b.co' }, { origin: 'https://evil.example' }), s)).status, 403);
  assert.equal((await handleWaitlist(post({ email: 'a@b.co' }, { origin: 'https://whittlebrowser.app' }), s)).status, 200);
  assert.equal(s.rows.length, 1);
});

test('only POST, only small JSON bodies', async () => {
  const s = memory();
  assert.equal((await handleWaitlist(post(null, {}, 'GET'), s)).status, 405);
  assert.equal((await handleWaitlist(post('not json'), s)).status, 400);
  assert.equal((await handleWaitlist(post('[1]'), s)).status, 400);
  assert.equal((await handleWaitlist(post({ email: 'a@b.co', pad: 'x'.repeat(3000) }), s)).status, 413);
});

test('a failing store is a 500, not a crash', async () => {
  const res = await handleWaitlist(post({ email: 'a@b.co' }), { add: async () => { throw new Error('db down'); } });
  assert.equal(res.status, 500);
});

test('normalizeEmail', () => {
  assert.equal(normalizeEmail('A@B.io'), 'a@b.io');
  assert.equal(normalizeEmail('a@b'), null);
});

test('disposable email services are refused, with a distinct error', async () => {
  const s = memory();
  for (const email of ['a@mailinator.com', 'A@MAILINATOR.COM', 'a@sub.mailinator.com', 'a@guerrillamail.com', 'a@10minutemail.com']) {
    const res = await handleWaitlist(post({ email }), s);
    assert.equal(res.status, 400, email);
    assert.deepEqual(await res.json(), { ok: false, error: 'disposable_email' });
  }
  assert.equal(s.rows.length, 0);
});

test('real providers and look-alike domains are accepted', async () => {
  const s = memory();
  for (const email of ['a@gmail.com', 'a@outlook.com', 'a@company.io', 'a@mailinator-fans.io', 'a@mailinator.com.example.org']) {
    assert.equal((await handleWaitlist(post({ email }), s)).status, 200, email);
  }
  assert.equal(s.rows.length, 5);
});

test('isDisposable matches by domain suffix only', () => {
  assert.equal(isDisposable('x@mailinator.com'), true);
  assert.equal(isDisposable('x@deep.sub.mailinator.com'), true);
  assert.equal(isDisposable('x@mailinator.com.'), true);
  assert.equal(isDisposable('x@mailinator-fans.io'), false);
  assert.equal(isDisposable('x@com'), false);
});

test('the bundled blocklist is large and does not contain mainstream providers', () => {
  assert.ok(DISPOSABLE_DOMAINS.length > 5000);
  for (const d of ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'fastmail.com']) assert.equal(DISPOSABLE_DOMAINS.includes(d), false, d);
});
