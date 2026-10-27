import { simpleParser } from 'mailparser';
import { describe, expect, test } from 'vitest';
import { buildMessage, type MessageInput } from '../src/compose.ts';

const baseInput = (overrides: Partial<MessageInput> = {}): MessageInput => ({
  from: { name: 'Анна из Example', address: 'anna@example.ru' },
  to: ['ivan@example.com'],
  subject: 'Отчёт по видимости бренда',
  markdown: 'Привет, Иван!\n\nОтчёт готов: [посмотреть отчёт](https://example.ru/r/42).\n\nАнна',
  messageId: '<draft-1@example.ru>',
  date: new Date('2026-10-27T10:00:00Z'),
  ...overrides,
});

describe('message built from markdown', () => {
  test('HTML part carries the link as words', async () => {
    const raw = await buildMessage(baseInput());

    const parsed = await simpleParser(raw);

    expect(parsed.html).toContain('<a href="https://example.ru/r/42">посмотреть отчёт</a>');
  });

  test('text part spells the link out next to its words', async () => {
    const raw = await buildMessage(baseInput());

    const parsed = await simpleParser(raw);

    expect(parsed.text).toContain('посмотреть отчёт (https://example.ru/r/42)');
  });

  test('text and HTML go out as multipart/alternative', async () => {
    const raw = await buildMessage(baseInput());

    expect(raw.toString('latin1')).toMatch(/Content-Type: multipart\/alternative/i);
  });

  test('sender display name is Cyrillic in From, encoded for the wire', async () => {
    const raw = await buildMessage(baseInput());

    const parsed = await simpleParser(raw);

    expect(parsed.from?.value).toEqual([{ name: 'Анна из Example', address: 'anna@example.ru' }]);
    expect(raw.toString('latin1')).toMatch(/^From: =\?UTF-8\?/im);
  });

  test('Cc and Bcc stay in the stored draft so send_draft can address them', async () => {
    const raw = await buildMessage(baseInput({ cc: ['anna@example.com'], bcc: ['archive@example.ru'] }));

    const parsed = await simpleParser(raw);

    expect(addresses(parsed.cc)).toEqual(['anna@example.com']);
    expect(addresses(parsed.bcc)).toEqual(['archive@example.ru']);
  });

  test('reply threading headers are written', async () => {
    const raw = await buildMessage(
      baseInput({ inReplyTo: '<orig@example.com>', references: ['<root@example.com>', '<orig@example.com>'] }),
    );

    const parsed = await simpleParser(raw);

    expect(parsed.inReplyTo).toBe('<orig@example.com>');
    expect(parsed.references).toEqual(['<root@example.com>', '<orig@example.com>']);
  });

  test('Message-ID and Date are the ones passed in', async () => {
    const raw = await buildMessage(baseInput());

    const parsed = await simpleParser(raw);

    expect(parsed.messageId).toBe('<draft-1@example.ru>');
    expect(parsed.date?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });

  test('quoted original goes below the reply, escaped and never rendered as markdown', async () => {
    const raw = await buildMessage(
      baseInput({ quote: { attribution: 'Иван <ivan@example.com> пишет:', text: 'Где отчёт?\n<img src="https://tracker.example/p.gif">' } }),
    );

    const parsed = await simpleParser(raw);

    expect(parsed.text).toContain('> Где отчёт?');
    expect(parsed.html).toContain('&lt;img src=&quot;https://tracker.example/p.gif&quot;&gt;');
    expect(parsed.html).not.toContain('<img');
  });
});

function addresses(field: unknown): string[] {
  const groups = (Array.isArray(field) ? field : [field]) as { value: { address?: string }[] }[];
  return groups.flatMap((group) => group.value.map((entry) => entry.address ?? ''));
}
