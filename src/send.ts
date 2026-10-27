import { simpleParser, type AddressObject, type EmailAddress } from 'mailparser';
import { prepareOutgoing } from './wire.ts';

export interface SmtpEnvelope {
  from: string;
  to: string[];
}

export interface SmtpSender {
  send(envelope: SmtpEnvelope, raw: Buffer): Promise<{ accepted: string[]; rejected: string[] }>;
}

/** IMAP side of sending, bound to one account. */
export interface DraftMailbox {
  fetchDraft(uid: number): Promise<Buffer | null>;
  /** Appends to the Sent folder, flagged \Seen; resolves to the folder path. */
  appendToSent(raw: Buffer): Promise<string>;
  discardDraft(uid: number): Promise<void>;
  isGmail(): boolean;
}

export interface SendDraftParams {
  account: { email: string; smtpSavesToSent: boolean };
  uid: number;
  mailbox: DraftMailbox;
  smtp: SmtpSender;
  messageId: string;
  now: Date;
}

export interface SendReport {
  messageId: string;
  accepted: string[];
  rejected: string[];
  sentCopy: 'appended' | 'kept-by-smtp-server' | 'append-failed';
  sentFolder?: string | undefined;
  draftRemoved: boolean;
  warnings: string[];
}

export async function sendDraft({ account, uid, mailbox, smtp, messageId, now }: SendDraftParams): Promise<SendReport> {
  const draft = await mailbox.fetchDraft(uid);
  if (!draft) throw new Error(`No draft with UID ${uid} in Drafts. Find it with search_messages, folder "drafts".`);

  const parsed = await simpleParser(draft, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true, keepCidLinks: true });
  const from = addressesOf(parsed.from);
  if (from.length !== 1 || from[0]?.toLowerCase() !== account.email.toLowerCase()) {
    // SPF/DMARC: an account may only send its own address through its own SMTP server.
    throw new Error(`Draft From is "${from.join(', ')}", but this account sends only as ${account.email}. Nothing was sent.`);
  }
  const recipients = [...new Set([...addressesOf(parsed.to), ...addressesOf(parsed.cc), ...addressesOf(parsed.bcc)])];
  if (recipients.length === 0) throw new Error('Draft has no recipients in To, Cc or Bcc. Nothing was sent.');

  const wire = prepareOutgoing(draft, { messageId, date: now });
  const { accepted, rejected } = await smtp.send({ from: account.email, to: recipients }, wire);

  const warnings: string[] = [];
  if (rejected.length > 0) warnings.push(`SMTP server rejected: ${rejected.join(', ')}`);

  let sentCopy: SendReport['sentCopy'] = 'kept-by-smtp-server';
  let sentFolder: string | undefined;
  if (!account.smtpSavesToSent) {
    if (mailbox.isGmail()) {
      warnings.push('Config says the SMTP server keeps no copy, but this is Gmail, which files sent mail itself: expect duplicates in Sent.');
    }
    try {
      sentFolder = await mailbox.appendToSent(wire);
      sentCopy = 'appended';
    } catch (error) {
      sentCopy = 'append-failed';
      warnings.push(`Sent, but appending the copy to Sent failed: ${errorMessage(error)}`);
    }
  }

  let draftRemoved = false;
  try {
    await mailbox.discardDraft(uid);
    draftRemoved = true;
  } catch (error) {
    warnings.push(`Sent, but removing the draft failed: ${errorMessage(error)}`);
  }

  return { messageId, accepted, rejected, sentCopy, sentFolder, draftRemoved, warnings };
}

export function addressesOf(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const flatten = (entries: EmailAddress[]): string[] =>
    entries.flatMap((entry) => (entry.group ? flatten(entry.group) : entry.address ? [entry.address] : []));
  return (Array.isArray(field) ? field : [field]).flatMap((object) => flatten(object.value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
