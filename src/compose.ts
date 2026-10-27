import { randomUUID } from 'node:crypto';
import { convert } from 'html-to-text';
import { marked } from 'marked';
import MailComposer from 'nodemailer/lib/mail-composer';

/** "ivan@example.com", "Иван <ivan@example.com>" or a structured address. */
export type Recipient = string | { name?: string | undefined; address: string };

export interface MessageInput {
  from: { name: string; address: string };
  to: Recipient[];
  cc?: Recipient[] | undefined;
  bcc?: Recipient[] | undefined;
  subject: string;
  markdown: string;
  messageId: string;
  date: Date;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
  /** Original message quoted under a reply; plain text, never parsed as markdown. */
  quote?: { attribution: string; text: string } | undefined;
}

export function newMessageId(fromAddress: string): string {
  return `<${randomUUID()}@${fromAddress.split('@')[1]}>`;
}

const HEADINGS =['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({ selector, options: { uppercase: false } }));

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { linkBrackets: ['(', ')'], hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
      ...HEADINGS,
    ],
  });
}

export function renderMarkdown(markdown: string): { html: string; text: string } {
  // breaks: a single newline in an email body is a line break (signatures, addresses).
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true });
  return { html, text: htmlToText(html) };
}

export async function buildMessage(input: MessageInput): Promise<Buffer> {
  const body = renderMarkdown(input.markdown);
  const quote = input.quote;
  const html = wrapHtml(body.html + (quote ? quoteAsHtml(quote) : ''));
  const text = body.text + (quote ? quoteAsText(quote) : '');

  const node = new MailComposer({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    messageId: input.messageId,
    date: input.date,
    inReplyTo: input.inReplyTo,
    references: input.references,
    text,
    html,
  }).compile();
  // MailComposer drops Bcc by default; a stored draft must keep it or send_draft cannot reach those recipients.
  node.keepBcc = true;
  return node.build();
}

function wrapHtml(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
}

function quoteAsText(quote: { attribution: string; text: string }): string {
  const lines = quote.text.split(/\r?\n/).map((line) => (line ? `> ${line}` : '>'));
  return `\n\n${quote.attribution}\n${lines.join('\n')}\n`;
}

function quoteAsHtml(quote: { attribution: string; text: string }): string {
  const text = escapeHtml(quote.text).replace(/\r?\n/g, '<br>');
  return (
    `<br><div>${escapeHtml(quote.attribution)}</div>` +
    `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${text}</blockquote>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
