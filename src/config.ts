import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as z from 'zod/v4';

const execFileAsync = promisify(execFile);

const endpointSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    /** true: implicit TLS (993/465); false: plain connection that must upgrade with STARTTLS. */
    secure: z.boolean(),
  })
  .strict();

const passwordSchema = z.union([
  z.object({ keychain: z.object({ service: z.string().min(1), account: z.string().min(1) }).strict() }).strict(),
  z.object({ env: z.string().min(1) }).strict(),
]);

const accountSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, "-" and "_"'),
    email: z.email(),
    displayName: z.string().min(1),
    /** IMAP/SMTP login when it differs from the address. */
    login: z.string().min(1).optional(),
    imap: endpointSchema,
    smtp: endpointSchema,
    /** Whether the SMTP server files a copy in Sent by itself (Gmail does); if not, send_draft appends one over IMAP. */
    smtpSavesToSent: z.boolean(),
    password: passwordSchema,
  })
  .strict();

const configSchema = z
  .object({ accounts: z.array(accountSchema).min(1) })
  .strict()
  .refine((config) => new Set(config.accounts.map((account) => account.id)).size === config.accounts.length, {
    message: 'account ids must be unique',
  });

export type AccountConfig = z.infer<typeof accountSchema>;

export function configPath(): string {
  return process.env.MAIL_MCP_CONFIG ?? join(homedir(), '.config', 'mail-mcp', 'accounts.json');
}

/** Read on every call, so config edits apply without restarting the server. */
export async function loadAccounts(): Promise<AccountConfig[]> {
  const path = configPath();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config not found at ${path}. Create it from accounts.example.json (see README) or set MAIL_MCP_CONFIG.`);
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Config ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Config ${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data.accounts;
}

export async function getAccount(id: string): Promise<AccountConfig> {
  const accounts = await loadAccounts();
  const account = accounts.find((candidate) => candidate.id === id);
  if (!account) throw new Error(`Unknown account "${id}". Configured accounts: ${accounts.map((a) => a.id).join(', ')}`);
  return account;
}

const resolvedSecrets = new Set<string>();

export async function resolvePassword(account: AccountConfig): Promise<string> {
  const source = account.password;
  const secret = 'env' in source ? passwordFromEnv(source.env) : await passwordFromKeychain(source.keychain);
  resolvedSecrets.add(secret);
  return secret;
}

/** Last line of defence: library errors should never echo a password, but tool output must not carry one either way. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const secret of resolvedSecrets) {
    if (secret.length >= 4) redacted = redacted.replaceAll(secret, '[redacted]');
  }
  return redacted;
}

/** Where the password comes from and whether it is there; never the value. */
export async function describePassword(account: AccountConfig): Promise<string> {
  const source = account.password;
  if ('env' in source) return `env ${source.env}: ${process.env[source.env] ? 'set' : 'NOT SET'}`;
  const { service, account: item } = source.keychain;
  try {
    // Without -w the item's attributes are read but not its secret.
    await execFileAsync('security', ['find-generic-password', '-s', service, '-a', item], { timeout: 10_000 });
    return `Keychain ${service} / ${item}: found`;
  } catch {
    return `Keychain ${service} / ${item}: NOT FOUND`;
  }
}

function passwordFromEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} with the mailbox password is not set.`);
  return value;
}

async function passwordFromKeychain({ service, account }: { service: string; account: string }): Promise<string> {
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
      timeout: 10_000,
    });
    const secret = stdout.replace(/\r?\n$/, '');
    if (!secret) throw new Error('empty password');
    return secret;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // 44 = errSecItemNotFound
    if (code === 44) {
      throw new Error(
        `No Keychain item for service "${service}", account "${account}". Add it with: security add-generic-password -U -s ${service} -a ${account} -w`,
      );
    }
    throw new Error(`Reading the password from Keychain (service "${service}", account "${account}") failed, exit code ${String(code)}.`);
  }
}
