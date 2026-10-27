import { afterEach, describe, expect, test, vi } from 'vitest';
import { searchQuery } from '../src/search.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('search criteria', () => {
  test('since keeps its calendar day in a time zone east of UTC', () => {
    vi.stubEnv('TZ', 'Europe/Moscow');

    const query = searchQuery({ since: '2026-10-27' });

    // imapflow sends SINCE as the UTC date of this value.
    expect((query.since as Date).toISOString().slice(0, 10)).toBe('2026-10-27');
  });

  test('unread maps to the \\Seen flag being absent', () => {
    expect(searchQuery({ unread: true })).toEqual({ seen: false });
  });

  test('no filters selects every message', () => {
    expect(searchQuery({})).toEqual({ all: true });
  });
});
