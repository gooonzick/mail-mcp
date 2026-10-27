import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// The server runs as a real stdio child process; nothing here touches a mail server.
const SECRET = 'not-a-real-password-7f3a';
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
let client: Client;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mail-mcp-test-'));
  const config = join(dir, 'accounts.json');
  const endpoint = { host: 'imap.invalid', port: 993, secure: true };
  await writeFile(
    config,
    JSON.stringify({
      accounts: [
        {
          id: 'test',
          email: 'me@example.com',
          displayName: 'Тест',
          imap: endpoint,
          smtp: { ...endpoint, port: 465 },
          smtpSavesToSent: false,
          password: { env: 'MAIL_MCP_TEST_PASSWORD' },
        },
      ],
    }),
  );
  client = new Client({ name: 'mail-mcp-test', version: '0.0.0' });
  const env = { ...getDefaultEnvironment(), MAIL_MCP_CONFIG: config, MAIL_MCP_TEST_PASSWORD: SECRET };
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env }));
}, 20_000);

afterAll(async () => {
  await client?.close();
  await rm(dir, { recursive: true, force: true });
});

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text?: string }[]).map((part) => part.text ?? '').join('\n');

describe('mail-mcp over stdio', () => {
  test('exposes the mail tools and send_draft is the only one that reaches outside the mailbox', async () => {
    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name).sort();
    const outward = tools
      .filter((tool) => tool.annotations?.openWorldHint !== false || (tool.annotations?.readOnlyHint !== true && tool.annotations?.destructiveHint !== false))
      .map((tool) => tool.name);
    expect(names).toEqual(['create_draft', 'get_message', 'list_accounts', 'list_folders', 'mark', 'move', 'reply', 'search_messages', 'send_draft']);
    expect(outward).toEqual(['send_draft']);
  });

  test('list_accounts tells where the password comes from without revealing it', async () => {
    const result = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(textOf(result)).toContain('env MAIL_MCP_TEST_PASSWORD: set');
    expect(textOf(result)).not.toContain(SECRET);
  });

  test('unknown account is a tool error naming the configured accounts', async () => {
    const result = await client.callTool({ name: 'list_folders', arguments: { account: 'nope' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Configured accounts: test/);
  });
});
