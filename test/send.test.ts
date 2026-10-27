import { describe, expect, test } from 'vitest';
import { buildMessage } from '../src/compose.ts';
import { sendDraft, type DraftMailbox, type SmtpEnvelope, type SmtpSender } from '../src/send.ts';

const regru = { email: 'anna@example.ru', smtpSavesToSent: false };
const gmail = { email: 'me@gmail.com', smtpSavesToSent: true };

class FakeMailbox implements DraftMailbox {
  drafts = new Map<number, Buffer>();
  sentFolderCopies: Buffer[] = [];
  removedDrafts: number[] = [];
  gmail = false;

  async fetchDraft(uid: number): Promise<Buffer | null> {
    return this.drafts.get(uid) ?? null;
  }

  async appendToSent(raw: Buffer): Promise<string> {
    this.sentFolderCopies.push(raw);
    return 'Sent';
  }

  async discardDraft(uid: number): Promise<void> {
    this.removedDrafts.push(uid);
    this.drafts.delete(uid);
  }

  isGmail(): boolean {
    return this.gmail;
  }
}

class FakeSmtp implements SmtpSender {
  delivered: { envelope: SmtpEnvelope; raw: Buffer }[] = [];
  failure?: Error;

  async send(envelope: SmtpEnvelope, raw: Buffer) {
    if (this.failure) throw this.failure;
    this.delivered.push({ envelope, raw });
    return { accepted: envelope.to, rejected: [] };
  }
}

const draftFrom = (address: string, extra: { bcc?: string[] } = {}) =>
  buildMessage({
    from: { name: 'Анна из Example', address },
    to: ['ivan@example.com'],
    bcc: extra.bcc,
    subject: 'Тест',
    markdown: 'Проверка отправки',
    messageId: '<draft-1@example.ru>',
    date: new Date('2026-10-26T09:00:00Z'),
  });

const mailboxWithDraft = async (address: string, extra: { bcc?: string[] } = {}) => {
  const mailbox = new FakeMailbox();
  mailbox.drafts.set(7, await draftFrom(address, extra));
  return mailbox;
};

const send = (account: typeof regru, mailbox: FakeMailbox, smtp: FakeSmtp, uid = 7) =>
  sendDraft({ account, uid, mailbox, smtp, messageId: '<sent-1@example.ru>', now: new Date('2026-10-27T13:32:00Z') });

describe('copy in Sent after sending', () => {
  test('exact transmitted bytes are appended when the SMTP server keeps no copy', async () => {
    const mailbox = await mailboxWithDraft(regru.email);
    const smtp = new FakeSmtp();

    const report = await send(regru, mailbox, smtp);

    expect(mailbox.sentFolderCopies).toEqual([smtp.delivered[0]?.raw]);
    expect(report.sentCopy).toBe('appended');
  });

  test('nothing is appended when the SMTP server files the copy itself', async () => {
    const mailbox = await mailboxWithDraft(gmail.email);
    mailbox.gmail = true;
    const smtp = new FakeSmtp();

    const report = await send(gmail, mailbox, smtp);

    expect(smtp.delivered).toHaveLength(1);
    expect(mailbox.sentFolderCopies).toEqual([]);
    expect(report.sentCopy).toBe('kept-by-smtp-server');
  });

  test('config stays authoritative on Gmail but the report warns about duplicates', async () => {
    const mailbox = await mailboxWithDraft(gmail.email);
    mailbox.gmail = true;

    const report = await send({ ...gmail, smtpSavesToSent: false }, mailbox, new FakeSmtp());

    expect(mailbox.sentFolderCopies).toHaveLength(1);
    expect(report.warnings.join(' ')).toMatch(/duplicate/i);
  });
});

describe('send_draft delivery', () => {
  test('SMTP failure appends nothing and keeps the draft', async () => {
    const mailbox = await mailboxWithDraft(regru.email);
    const smtp = new FakeSmtp();
    smtp.failure = new Error('535 authentication failed');

    await expect(send(regru, mailbox, smtp)).rejects.toThrow(/535/);
    expect(mailbox.sentFolderCopies).toEqual([]);
    expect(mailbox.removedDrafts).toEqual([]);
  });

  test('sent draft leaves Drafts', async () => {
    const mailbox = await mailboxWithDraft(regru.email);

    const report = await send(regru, mailbox, new FakeSmtp());

    expect(mailbox.removedDrafts).toEqual([7]);
    expect(report.draftRemoved).toBe(true);
  });

  test('Bcc recipients get the message without the Bcc header going out', async () => {
    const mailbox = await mailboxWithDraft(regru.email, { bcc: ['archive@example.ru'] });
    const smtp = new FakeSmtp();

    await send(regru, mailbox, smtp);

    expect(smtp.delivered[0]?.envelope).toEqual({ from: regru.email, to: ['ivan@example.com', 'archive@example.ru'] });
    expect(smtp.delivered[0]?.raw.toString()).not.toMatch(/^bcc:/im);
  });

  test('message goes out under a fresh Message-ID', async () => {
    const mailbox = await mailboxWithDraft(regru.email);

    const report = await send(regru, mailbox, new FakeSmtp());

    expect(report.messageId).toBe('<sent-1@example.ru>');
  });

  test('draft written from another address is refused before anything is sent', async () => {
    const mailbox = await mailboxWithDraft('someone@else.example');
    const smtp = new FakeSmtp();

    await expect(send(regru, mailbox, smtp)).rejects.toThrow(/From/);
    expect(smtp.delivered).toEqual([]);
  });

  test('unknown draft UID is an error', async () => {
    const mailbox = await mailboxWithDraft(regru.email);

    await expect(send(regru, mailbox, new FakeSmtp(), 99)).rejects.toThrow(/No draft with UID 99/);
  });
});
