#!/usr/bin/env node
/**
 * whittlebrowser: stdio MCP server.
 *
 *   whittlebrowser                        launch Chromium with ~/.whittlebrowser/profile (headed)
 *   whittlebrowser --host                 drive a running host app, such as the desktop browser (its per-site AI modes and approvals apply)
 *   whittlebrowser --cdp http://127.0.0.1:9222
 *
 * Flags: --headless --ephemeral --profile DIR --channel chrome --budget N --allow-site HOST (repeatable)
 *        --risk confirm|auto|deny --robots off|warn|enforce --default-off --no-identify --allow-file-urls --humanize
 *        --bot-key FILE --bot-agent URL --show-cursor (default with --host; --no-cursor) --xray --fast
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { launch, type Launched } from '../driver/launch.js';
import { Session } from '../driver/session.js';
import { StaticPolicy, HostPolicy, type Policy } from '../driver/policy.js';

function parse(argv: string[]) {
  const o: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    const takes = ['profile', 'channel', 'budget', 'allow-site', 'risk', 'robots', 'cdp', 'bot-key', 'bot-agent'].includes(k);
    if (takes && next !== undefined) {
      i++;
      if (k === 'allow-site') o[k] = [...((o[k] as string[]) || []), next];
      else o[k] = next;
    } else o[k] = true;
  }
  return o;
}

const args = parse(process.argv.slice(2));
let launched: Launched | null = null;
let session: Promise<Session> | null = null;

async function getSession(): Promise<Session> {
  if (session) return session;
  session = (async () => {
    let policy: Policy;
    let cdpUrl = args.cdp as string | undefined;
    if (args.host) {
      const host = HostPolicy.fromDisk();
      if (!host) throw new Error('No host app is running (no ~/.whittlebrowser/host.json)');
      policy = host.policy;
      cdpUrl = host.cdp;
    } else {
      policy = new StaticPolicy({
        defaultMode: args['default-off'] ? 'off' : 'allowed',
        risk: (args.risk as 'confirm' | 'auto' | 'deny') || 'confirm',
        allowSensitive: (args['allow-site'] as string[]) || [],
      });
    }
    launched = await launch({
      cdpUrl,
      headless: !!args.headless,
      profileDir: args.ephemeral ? null : (args.profile as string | undefined),
      channel: args.channel as string | undefined,
      botAuth: args['bot-key'] && args['bot-agent'] ? { keyFile: args['bot-key'] as string, agentUrl: args['bot-agent'] as string } : undefined,
    });
    return new Session(launched.context, policy, {
      budget: args.budget ? +args.budget : undefined,
      robots: (args.robots as 'off' | 'warn' | 'enforce') || 'warn',
      identify: !args['no-identify'],
      allowFileUrls: !!args['allow-file-urls'],
      // Watching in a host app: human-like pointer and typing by default (--fast to skip).
      humanize: !!args.humanize || (!!args.host && !args.fast),
      showCursor: !!args['show-cursor'] || (!!args.host && !args['no-cursor']),
      xray: !!args.xray,
    });
  })();
  session.catch(() => { session = null; });
  return session;
}

const server = createServer(getSession);
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await launched?.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
