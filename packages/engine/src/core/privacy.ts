/**
 * Privacy filter: the single choke point every outbound string passes through.
 *
 * - Secrets found in page text (cards, API keys, JWTs, private keys, SSNs, IBANs) are replaced with
 *   reversible tokens like ‹card:1›. The model can pass a token back (e.g. type ‹card:1›) and the real
 *   value is substituted locally, so it never travels to the LLM.
 * - Named secrets (vault) are referenced as secret:NAME and resolved locally; once typed, their values
 *   are also scrubbed from anything echoed back.
 * - Sensitive field values are masked inside the page before they ever reach Node (see page/agent.ts).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface Rule {
  kind: string;
  re: RegExp;
  check?: (m: string) => boolean;
  /** Replace only this capture group (1) instead of the whole match. */
  group?: boolean;
}

function luhn(s: string): boolean {
  const d = s.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0 && !/^(\d)\1+$/.test(d);
}

function ibanOk(s: string): boolean {
  const v = s.replace(/\s/g, '');
  if (v.length < 15 || v.length > 34) return false;
  const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + +ch) % 97;
  return m === 1;
}

const RULES: Rule[] = [
  { kind: 'privkey', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'key', re: /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'key', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'key', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'key', re: /\b(?:hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g },
  { kind: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: luhn },
  { kind: 'ssn', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, check: ibanOk },
  { kind: 'secret', re: /(?<!‹)\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?([^\s"'<>]{6,})/gi, group: true },
];

const TOKEN_RE = /‹([a-z]+):([A-Za-z0-9_]+)›/g;

export interface PrivacyOptions {
  /** Also tokenise e-mail addresses. Off by default because many tasks need them. */
  emails?: boolean;
  /** Extra vault entries (name -> value). Env WB_SECRET_<NAME> and ~/.whittlebrowser/secrets.json are read too. */
  vault?: Record<string, string>;
}

export class Privacy {
  private tokens = new Map<string, string>();
  private reverse = new Map<string, string>();
  private counters = new Map<string, number>();
  /** Exact values that must never be emitted (vault values once used, typed secrets). */
  private known = new Map<string, string>();
  private vault: Record<string, string>;
  /** Count of redactions performed, by kind (for "What AI sees" and benchmarks). */
  readonly stats: Record<string, number> = {};

  constructor(private opts: PrivacyOptions = {}) {
    this.vault = { ...loadVault(), ...(opts.vault || {}) };
    for (const [name, v] of Object.entries(this.vault)) if (v && v.length >= 4) this.known.set(v, `‹secret:${name}›`);
  }

  private tokenFor(kind: string, value: string): string {
    const existing = this.reverse.get(value);
    if (existing) return existing;
    const n = (this.counters.get(kind) || 0) + 1;
    this.counters.set(kind, n);
    const t = `‹${kind}:${n}›`;
    this.tokens.set(t, value);
    this.reverse.set(value, t);
    return t;
  }

  /** Redact everything that must not leave the machine. Idempotent. */
  scrub(text: string): string {
    if (!text) return text;
    let out = text;
    for (const [v, t] of this.known) if (out.includes(v)) { out = out.split(v).join(t); this.bump('secret'); }
    for (const rule of RULES) {
      out = out.replace(rule.re, (m: string, g1?: string) => {
        if (rule.group && typeof g1 === 'string') {
          if (g1.startsWith('‹')) return m;
          this.bump(rule.kind);
          return m.replace(g1, this.tokenFor(rule.kind, g1));
        }
        if (rule.check && !rule.check(m)) return m;
        this.bump(rule.kind);
        return this.tokenFor(rule.kind, m);
      });
    }
    if (this.opts.emails) {
      out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => { this.bump('email'); return this.tokenFor('email', m); });
    }
    return out;
  }

  private bump(kind: string) {
    this.stats[kind] = (this.stats[kind] || 0) + 1;
  }

  /**
   * Resolve tokens and secret refs in model-provided text to real values, locally.
   * Accepts "‹card:1›" tokens, and "secret:NAME" when it is the entire argument.
   */
  reveal(text: string): { value: string; secret: boolean; missing?: string } {
    const whole = text.match(/^secret:([A-Za-z0-9_.-]+)$/);
    if (whole) {
      const name = whole[1];
      const v = this.vault[name] ?? this.vault[name.toUpperCase()];
      if (v === undefined) return { value: '', secret: true, missing: name };
      this.known.set(v, `‹secret:${name}›`);
      return { value: v, secret: true };
    }
    let secret = false;
    const value = text.replace(TOKEN_RE, (m, kind: string, id: string) => {
      if (kind === 'secret') {
        const v = this.vault[id];
        if (v !== undefined) { secret = true; return v; }
        return m;
      }
      const v = this.tokens.get(m);
      if (v !== undefined) { secret = true; return v; }
      return m;
    });
    return { value, secret };
  }

  /** Register a value the model must never see again (e.g. something typed from the vault). */
  remember(value: string, label = 'typed') {
    if (value && value.length >= 4) this.known.set(value, `‹secret:${label}›`);
  }

  vaultNames(): string[] {
    return Object.keys(this.vault);
  }
}

function loadVault(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('WB_SECRET_') && v) out[k.slice(10)] = v;
  const file = process.env.WB_SECRETS_FILE || join(homedir(), '.whittlebrowser', 'secrets.json');
  try {
    if (existsSync(file)) {
      const mode = statSync(file).mode & 0o077;
      if (mode) process.stderr.write(`whittlebrowser: ${file} is readable by others; chmod 600 it\n`);
      Object.assign(out, JSON.parse(readFileSync(file, 'utf8')));
    }
  } catch {
    /* ignore malformed vault */
  }
  return out;
}
