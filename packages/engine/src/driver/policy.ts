/**
 * Who decides what the agent may see and do. StaticPolicy is for headless/standalone use (flags and
 * config); HostPolicy asks the host app (for example the WhittleBrowser desktop browser), where the user sees the AI dot, approval prompts
 * and the "What AI sees" log.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SiteMode = 'off' | 'ask' | 'allowed';

export interface ApprovalRequest {
  kind: 'site' | 'risk' | 'navigate';
  origin: string;
  summary: string;
}

/** 'yes' run it · 'no' refused · 'confirm' the agent must re-issue with confirm:true (no human in the loop). */
export type Approval = 'yes' | 'no' | 'confirm';

export interface AgentEvent {
  type: 'observe' | 'act' | 'navigate' | 'find' | 'extract' | 'blocked' | 'handoff' | 'tabs' | 'screenshot' | 'wait' | 'step' | 'research';
  origin: string;
  /** Exactly what was sent to the model (already scrubbed). */
  text: string;
  tokens: number;
  at: number;
  /** saved: tokens avoided vs a full page dump; injections: ⚠ lines; redactions: values masked or tokenised. */
  meta?: { saved: number; injections: number; redactions: number };
}

export interface Policy {
  siteMode(origin: string): Promise<SiteMode>;
  approve(req: ApprovalRequest): Promise<Approval>;
  /** Hosts where the user overrode auto-pause. */
  allowedSensitiveHosts(): Promise<string[]>;
  /** Block until the user says they are done (CAPTCHA, login, 2FA). Resolves false on timeout. */
  waitForUser?(reason: string, origin: string, timeoutMs: number): Promise<boolean>;
  log?(ev: AgentEvent): void;
  /** Open a tab in a host that cannot create targets over CDP (a host app). */
  openTab?(url: string, o?: { background?: boolean; agent?: boolean }): Promise<boolean>;
  /** CDP target ids the agent must never see or touch (e.g. private tabs). */
  excludedTargets?(): Promise<string[]>;
}

export interface StaticPolicyOptions {
  /** Default AI mode for sites without an explicit entry. Standalone default: allowed. */
  defaultMode?: SiteMode;
  sites?: Record<string, SiteMode>;
  /** How high-risk actions are approved without a UI: confirm (agent re-issues with confirm:true), auto, deny. */
  risk?: 'confirm' | 'auto' | 'deny';
  allowSensitive?: string[];
}

export class StaticPolicy implements Policy {
  constructor(private o: StaticPolicyOptions = {}) {}

  async siteMode(origin: string): Promise<SiteMode> {
    const host = hostOfOrigin(origin);
    const sites = this.o.sites || {};
    for (const [k, v] of Object.entries(sites)) if (host === k || host.endsWith('.' + k) || origin === k) return v;
    return this.o.defaultMode || 'allowed';
  }

  async approve(req: ApprovalRequest): Promise<Approval> {
    if (req.kind === 'site') return 'no';
    const r = this.o.risk || 'confirm';
    return r === 'auto' ? 'yes' : r === 'deny' ? 'no' : 'confirm';
  }

  async allowedSensitiveHosts(): Promise<string[]> {
    return this.o.allowSensitive || [];
  }
}

/** Talks to the host app's local control server (127.0.0.1, bearer token from ~/.whittlebrowser/host.json). */
export class HostPolicy implements Policy {
  constructor(private base: string, private token: string) {}

  static fromDisk(): { policy: HostPolicy; cdp: string } | null {
    const f = join(process.env.WB_HOME || join(homedir(), '.whittlebrowser'), 'host.json');
    if (!existsSync(f)) return null;
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as { cdpPort: number; controlPort: number; token: string };
      return { policy: new HostPolicy(`http://127.0.0.1:${j.controlPort}`, j.token), cdp: `http://127.0.0.1:${j.cdpPort}` };
    } catch {
      return null;
    }
  }

  private async req<T>(path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
    const res = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`host ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  async siteMode(origin: string): Promise<SiteMode> {
    try {
      return (await this.req<{ mode: SiteMode }>(`/policy?origin=${encodeURIComponent(origin)}`)).mode;
    } catch {
      return 'off'; // default-deny when the host is unreachable
    }
  }

  async approve(req: ApprovalRequest): Promise<Approval> {
    try {
      return (await this.req<{ answer: Approval }>('/approve', req, 5 * 60_000)).answer;
    } catch {
      return 'no';
    }
  }

  async allowedSensitiveHosts(): Promise<string[]> {
    try {
      return (await this.req<{ hosts: string[] }>('/sensitive-overrides')).hosts;
    } catch {
      return [];
    }
  }

  async waitForUser(reason: string, origin: string, timeoutMs: number): Promise<boolean> {
    try {
      return (await this.req<{ done: boolean }>('/handoff', { reason, origin }, timeoutMs)).done;
    } catch {
      return false;
    }
  }

  log(ev: AgentEvent): void {
    this.req('/log', ev).catch(() => {});
  }

  async excludedTargets(): Promise<string[]> {
    try {
      return (await this.req<{ ids: string[] }>('/excluded-targets')).ids;
    } catch {
      return [];
    }
  }

  async openTab(url: string, o: { background?: boolean; agent?: boolean } = {}): Promise<boolean> {
    try {
      return (await this.req<{ ok: boolean }>('/tabs/open', { url, ...o })).ok;
    } catch {
      return false;
    }
  }
}

function hostOfOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin;
  }
}
