export interface Address {
  name?: string | undefined;
  address: string;
}

export interface OriginalMessage {
  messageId?: string | undefined;
  references?: string[] | undefined;
  inReplyTo?: string | undefined;
  subject?: string | undefined;
  from: Address[];
  replyTo: Address[];
  to: Address[];
  cc: Address[];
}

export interface ReplyPlan {
  to: Address[];
  cc: Address[];
  subject: string;
  inReplyTo?: string | undefined;
  references: string[];
}

const REPLY_PREFIX = /^\s*(re|ответ)\s*(\[\d+\])?\s*:/i;

export function planReply(original: OriginalMessage, ownAddress: string, replyAll: boolean): ReplyPlan {
  const own = ownAddress.toLowerCase();
  const notOwn = (entry: Address) => entry.address.toLowerCase() !== own;
  // A reply to our own message (from Sent) continues the conversation with its recipients.
  const fromSelf = original.from.some((entry) => !notOwn(entry));
  const primary = fromSelf ? original.to : original.replyTo.length > 0 ? original.replyTo : original.from;
  const to = unique(primary.filter(notOwn));

  const addressed = new Set(to.map((entry) => entry.address.toLowerCase()));
  const others = fromSelf ? original.cc : [...original.to, ...original.cc];
  const cc = replyAll ? unique(others.filter((entry) => notOwn(entry) && !addressed.has(entry.address.toLowerCase()))) : [];

  const subject = original.subject ?? '';
  const parentChain = original.references ?? (original.inReplyTo ? [original.inReplyTo] : []);
  const references = [...new Set([...parentChain, ...(original.messageId ? [original.messageId] : [])])];

  return {
    to,
    cc,
    subject: REPLY_PREFIX.test(subject) ? subject : `Re: ${subject}`.trimEnd(),
    inReplyTo: original.messageId,
    references,
  };
}

function unique(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((entry) => {
    const key = entry.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
