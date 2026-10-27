/**
 * Turns a stored draft into the bytes handed to SMTP. nodemailer sends a `raw` message as is,
 * so Bcc has to be stripped here, and the draft's Message-ID/Date are replaced with fresh ones.
 */
export function prepareOutgoing(raw: Buffer, replacement: { messageId: string; date: Date }): Buffer {
  // latin1 maps every byte to one char and back, so 8-bit header bytes and the body survive untouched.
  const message = raw.toString('latin1');
  const separator = /\r?\n\r?\n/.exec(message);
  const headerEnd = separator ? separator.index : message.length;
  const eol = message.slice(0, headerEnd + 2).includes('\r\n') ? '\r\n' : '\n';

  const fields = splitFields(message.slice(0, headerEnd), eol);
  const replacements: Record<string, string> = {
    'message-id': `Message-ID: ${replacement.messageId}`,
    date: `Date: ${formatDate(replacement.date)}`,
  };
  const seen = new Set<string>();
  const header = fields.flatMap((field) => {
    const name = field.slice(0, field.indexOf(':')).trim().toLowerCase();
    if (name === 'bcc') return [];
    const replaced = replacements[name];
    if (replaced === undefined) return [field];
    if (seen.has(name)) return [];
    seen.add(name);
    return [replaced];
  });
  for (const [name, field] of Object.entries(replacements)) {
    if (!seen.has(name)) header.push(field);
  }

  return Buffer.from(header.join(eol) + message.slice(headerEnd), 'latin1');
}

/** Groups header lines into fields: a line starting with whitespace continues the previous field (RFC 5322 folding). */
function splitFields(headerText: string, eol: string): string[] {
  const fields: string[] = [];
  for (const line of headerText.split(eol)) {
    if (/^[ \t]/.test(line) && fields.length > 0) {
      fields[fields.length - 1] += eol + line;
    } else {
      fields.push(line);
    }
  }
  return fields;
}

function formatDate(date: Date): string {
  return date.toUTCString().replace(/GMT$/, '+0000');
}
