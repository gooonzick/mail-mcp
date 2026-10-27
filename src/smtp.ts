import nodemailer from 'nodemailer';
import { resolvePassword, type AccountConfig } from './config.ts';
import type { SmtpSender } from './send.ts';

/** Each account sends only through its own SMTP server: SPF for the domain lists that server, not any other. */
export async function smtpSender(account: AccountConfig): Promise<SmtpSender> {
  const pass = await resolvePassword(account);
  return {
    async send(envelope, raw) {
      const transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        // A non-TLS port must upgrade with STARTTLS before the password goes over the wire.
        requireTLS: !account.smtp.secure,
        auth: { user: account.login ?? account.email, pass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 120_000,
        logger: false,
        debug: false,
      });
      try {
        const info = await transporter.sendMail({ envelope: { from: envelope.from, to: envelope.to }, raw });
        const toText = (entry: string | { address: string }) => (typeof entry === 'string' ? entry : entry.address);
        return { accepted: info.accepted.map(toText), rejected: info.rejected.map(toText) };
      } finally {
        transporter.close();
      }
    },
  };
}
