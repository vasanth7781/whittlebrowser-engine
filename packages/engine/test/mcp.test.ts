import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let srv: Awaited<ReturnType<typeof serve>>;
let client: Client;

beforeAll(async () => {
  srv = await serve();
  client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', join(root, 'src/mcp/cli.ts'), '--headless', '--ephemeral', '--robots', 'off', '--no-identify'], cwd: root, stderr: 'ignore' }));
});
afterAll(async () => {
  await client?.close();
  await srv?.close();
});

describe('mcp', () => {
  it('exposes 9 small tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['act', 'extract', 'find', 'navigate', 'observe', 'research', 'screenshot', 'tabs', 'wait']);
    const defTokens = Math.ceil(JSON.stringify(tools).length / 3.6);
    expect(defTokens).toBeLessThan(1600);
  });

  it('navigates and acts through MCP', async () => {
    const nav = (await client.callTool({ name: 'navigate', arguments: { url: srv.url('shipping.html') } })) as { content: { text: string }[] };
    const t = nav.content[0].text;
    expect(t).toContain('form "Shipping"');
    const ref = +t.match(/\[(\d+)\] textbox "Email"/)![1];
    const act = (await client.callTool({ name: 'act', arguments: { do: 'type', ref, text: 'a@b.co' } })) as { content: { text: string }[] };
    expect(act.content[0].text).toContain('= "a@b.co"');
    const email = +t.match(/\[(\d+)\] textbox "Email"/)![1];
    const name = +t.match(/\[(\d+)\] textbox "Full name"/)![1];
    const batch = (await client.callTool({ name: 'act', arguments: { steps: [{ do: 'type', ref: email, text: 'x@y.co' }, { do: 'type', ref: name, text: 'Jane Doe' }] } })) as { content: { text: string }[] };
    expect(batch.content[0].text).toContain('= "x@y.co"');
    expect(batch.content[0].text).toContain('= "Jane Doe"');
    const shot = (await client.callTool({ name: 'screenshot', arguments: {} })) as { content: { type: string }[] };
    expect(shot.content.map((c) => c.type)).toEqual(['text', 'image']);
  });
});
