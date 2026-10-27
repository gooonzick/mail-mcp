import type { SearchObject } from 'imapflow';

export interface SearchFilters {
  from?: string | undefined;
  to?: string | undefined;
  subject?: string | undefined;
  /** YYYY-MM-DD */
  since?: string | undefined;
  unread?: boolean | undefined;
}

export function searchQuery(filters: SearchFilters): SearchObject {
  const query: SearchObject = {};
  if (filters.from) query.from = filters.from;
  if (filters.to) query.to = filters.to;
  if (filters.subject) query.subject = filters.subject;
  // UTC midnight: imapflow sends SINCE as the UTC calendar date, so local midnight east of UTC would mean the day before.
  if (filters.since) query.since = new Date(`${filters.since}T00:00:00Z`);
  if (filters.unread !== undefined) query.seen = !filters.unread;
  return Object.keys(query).length > 0 ? query : { all: true };
}
