// Drives the real server over stdio, the way Claude Code does.
//   node scripts/smoke.ts                       read-only check of every account: folders, newest inbox and sent
//   node scripts/smoke.ts <tool> '<json args>'   call one tool and print the result
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const client = new Client({ name: 'mail-mcp-smoke', version: '0.0.0' });
const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined));
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: 'inherit' }));

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text?: string }[]).map((part) => part.text ?? '').join('\n');
  console.log(`\n=== ${name} ${JSON.stringify(args)}${result.isError ? '  [ERROR]' : ''}\n${text}`);
  if (result.isError) process.exitCode = 1;
  return text;
}

async function newestUid(account: string, folder: string): Promise<number | undefined> {
  const listing = await call('search_messages', { account, folder, limit: 3 });
  const uid = /"uid": (\d+)/.exec(listing)?.[1];
  return uid ? Number(uid) : undefined;
}

try {
  const [tool, json] = process.argv.slice(2);
  if (tool) {
    await call(tool, json ? (JSON.parse(json) as Record<string, unknown>) : {});
  } else {
    const accounts = JSON.parse(await call('list_accounts', {})) as { id: string }[];
    for (const { id } of accounts) {
      await call('list_folders', { account: id });
      for (const folder of ['inbox', 'sent']) {
        const uid = await newestUid(id, folder);
        if (uid) await call('get_message', { account: id, folder, uid, maxChars: 1000 });
      }
    }
  }
} finally {
  await client.close();
}
