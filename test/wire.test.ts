import { describe, expect, test } from 'vitest';
import { prepareOutgoing } from '../src/wire.ts';

const draft = [
  'From: =?UTF-8?Q?=D0=90=D0=BD=D0=BD=D0=B0?= <anna@example.ru>',
  'To: ivan@example.com',
  'Bcc: archive@example.ru,',
  ' boss@example.ru',
  'Subject: Hello',
  'Message-ID: <draft-1@example.ru>',
  'Date: Mon, 26 Oct 2026 09:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Body line one',
  'Bcc: this line is body text, not a header',
  '',
].join('\r\n');

const replacement = { messageId: '<sent-1@example.ru>', date: new Date('2026-10-27T13:32:00Z') };

describe('message prepared for SMTP', () => {
  test('Bcc header is removed together with its folded continuation', () => {
    const wire = prepareOutgoing(Buffer.from(draft), replacement).toString();

    const headerBlock = wire.split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/bcc|boss@/i);
  });

  test('Message-ID and Date are replaced', () => {
    const wire = prepareOutgoing(Buffer.from(draft), replacement).toString();

    expect(wire).toContain('\r\nMessage-ID: <sent-1@example.ru>\r\n');
    expect(wire).toContain('\r\nDate: Tue, 27 Oct 2026 13:32:00 +0000\r\n');
    expect(wire).not.toContain('draft-1@example.ru');
  });

  test('other headers and the body bytes are unchanged', () => {
    const wire = prepareOutgoing(Buffer.from(draft), replacement).toString();

    const [headerBlock, body] = wire.split('\r\n\r\n');
    expect(headerBlock).toContain('To: ivan@example.com\r\nSubject: Hello');
    expect(body).toBe('Body line one\r\nBcc: this line is body text, not a header\r\n');
  });
});
