import { ImapFlow, type ImapFlowError, type ListResponse } from 'imapflow';
import { resolvePassword, type AccountConfig } from './config.ts';
import { findRoleFolder } from './folders.ts';
import type { DraftMailbox } from './send.ts';

/**
 * One connection per tool call, closed afterwards: shared hosting (reg.ru) caps concurrent IMAP sessions,
 * and a short-lived connection never goes stale between calls.
 */
export async function withImap<T>(account: AccountConfig, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    ...(account.imap.secure ? {} : { doSTARTTLS: true }),
    auth: { user: account.login ?? account.email, pass: await resolvePassword(account) },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    disableAutoIdle: true,
    clientInfo: { name: 'mail-mcp' },
  });
  // Failures reach the caller through the awaited command; an unhandled 'error' event would crash the server.
  client.on('error', (error: Error) => console.error(`[mail-mcp] IMAP ${account.id}: ${error.message}`));
  try {
    await client.connect();
  } catch (error) {
    throw withServerReason(error, `IMAP ${account.imap.host}`);
  }
  try {
    return await work(client);
  } catch (error) {
    throw withServerReason(error, `IMAP ${account.imap.host}`);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** imapflow leaves the server's reason outside `message` (which is often just "Command failed"); put it back in. */
function withServerReason(error: unknown, prefix: string): unknown {
  if (!(error instanceof Error)) return error;
  const details = error as ImapFlowError & { response?: unknown };
  const reason = details.responseText ?? (typeof details.response === 'string' ? details.response : undefined) ?? details.reason;
  if (!reason && !details.serverResponseCode && !details.authenticationFailed && !details.code) return error;
  const parts = [`${prefix}: ${error.message}`];
  if (reason) parts.push(reason);
  if (details.serverResponseCode) parts.push(`[${details.serverResponseCode}]`);
  else if (details.code) parts.push(`[${details.code}]`);
  if (details.authenticationFailed) parts.push('Login rejected: check the password in Keychain (Gmail needs an app password).');
  return new Error(parts.join(' '), { cause: error });
}

export async function withFolder<T>(client: ImapFlow, path: string, readOnly: boolean, work: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly });
  try {
    return await work();
  } finally {
    lock.release();
  }
}

export async function fetchSource(client: ImapFlow, path: string, uid: number): Promise<Buffer | null> {
  // EXAMINE (read-only) plus BODY.PEEK: reading never flips \Seen.
  return withFolder(client, path, true, async () => {
    const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    return message && message.source ? message.source : null;
  });
}

export async function appendDraft(client: ImapFlow, folders: ListResponse[], raw: Buffer, messageId: string) {
  const drafts = requireRole(folders, 'drafts');
  const result = await client.append(drafts.path, raw, ['\\Draft', '\\Seen'], new Date());
  if (!result) throw new Error(`Saving the draft to "${drafts.path}" failed.`);
  let uid = result.uid;
  if (!uid) {
    // Without UIDPLUS the server does not report the new UID; find the draft by its Message-ID.
    uid = await withFolder(client, drafts.path, true, async () => {
      const found = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      return found ? found.at(-1) : undefined;
    });
  }
  return { folder: drafts.path, uid };
}

export function draftMailbox(client: ImapFlow, folders: ListResponse[]): DraftMailbox {
  const drafts = requireRole(folders, 'drafts');
  return {
    fetchDraft: (uid) => fetchSource(client, drafts.path, uid),

    async appendToSent(raw) {
      const sent = requireRole(folders, 'sent');
      const result = await client.append(sent.path, raw, ['\\Seen'], new Date());
      if (!result) throw new Error(`APPEND to "${sent.path}" failed.`);
      return sent.path;
    },

    async discardDraft(uid) {
      // Moved to Trash rather than expunged: nothing is destroyed, and on Gmail an expunged draft
      // could survive as an unlabeled copy in All Mail.
      const trash = requireRole(folders, 'trash');
      await withFolder(client, drafts.path, false, async () => {
        const moved = await client.messageMove(String(uid), trash.path, { uid: true });
        if (!moved) throw new Error(`Moving the draft to "${trash.path}" failed.`);
      });
    },

    isGmail: () => client.capabilities.has('X-GM-EXT-1'),
  };
}

export function requireRole(folders: ListResponse[], role: 'drafts' | 'sent' | 'trash'): ListResponse {
  const folder = findRoleFolder(folders, role);
  if (!folder) throw new Error(`No ${role} folder found. Folders: ${folders.map((f) => f.path).join(', ')}`);
  return folder;
}
