import { describe, expect, test } from 'vitest';
import { planReply, type OriginalMessage } from '../src/reply.ts';

const own = 'anna@example.ru';

const original = (overrides: Partial<OriginalMessage> = {}): OriginalMessage => ({
  messageId: '<q-2@example.com>',
  references: ['<q-1@example.com>'],
  subject: 'Вопрос по отчёту',
  from: [{ name: 'Иван', address: 'ivan@example.com' }],
  replyTo: [],
  to: [{ name: 'Анна', address: own }],
  cc: [],
  ...overrides,
});

describe('reply recipients', () => {
  test('reply goes to the sender', () => {
    const plan = planReply(original(), own, false);

    expect(plan.to).toEqual([{ name: 'Иван', address: 'ivan@example.com' }]);
    expect(plan.cc).toEqual([]);
  });

  test('Reply-To overrides the sender', () => {
    const plan = planReply(original({ replyTo: [{ address: 'support@example.com' }] }), own, false);

    expect(plan.to).toEqual([{ address: 'support@example.com' }]);
  });

  test('reply-all copies the other recipients without our own address or duplicates', () => {
    const plan = planReply(
      original({
        to: [{ address: own.toUpperCase() }, { address: 'anna@example.com' }],
        cc: [{ address: 'Anna@Example.com' }, { address: 'ivan@example.com' }, { address: 'oleg@example.com' }],
      }),
      own,
      true,
    );

    expect(plan.to.map((a) => a.address)).toEqual(['ivan@example.com']);
    expect(plan.cc.map((a) => a.address)).toEqual(['anna@example.com', 'oleg@example.com']);
  });

  test('replying to our own sent message addresses its original recipients', () => {
    const plan = planReply(
      original({ from: [{ address: own }], to: [{ address: 'ivan@example.com' }], cc: [{ address: 'anna@example.com' }] }),
      own,
      true,
    );

    expect(plan.to.map((a) => a.address)).toEqual(['ivan@example.com']);
    expect(plan.cc.map((a) => a.address)).toEqual(['anna@example.com']);
  });
});

describe('reply subject', () => {
  test('gets a single Re: prefix', () => {
    expect(planReply(original(), own, false).subject).toBe('Re: Вопрос по отчёту');
  });

  test.each(['Re: Вопрос', 'RE: Вопрос', 'Ответ: Вопрос'])('keeps an existing prefix: %s', (subject) => {
    expect(planReply(original({ subject }), own, false).subject).toBe(subject);
  });
});

describe('reply threading', () => {
  test('In-Reply-To is the original Message-ID and References extend its chain', () => {
    const plan = planReply(original(), own, false);

    expect(plan.inReplyTo).toBe('<q-2@example.com>');
    expect(plan.references).toEqual(['<q-1@example.com>', '<q-2@example.com>']);
  });

  test('References fall back to In-Reply-To when the original has none', () => {
    const plan = planReply(original({ references: undefined, inReplyTo: '<q-1@example.com>' }), own, false);

    expect(plan.references).toEqual(['<q-1@example.com>', '<q-2@example.com>']);
  });
});
