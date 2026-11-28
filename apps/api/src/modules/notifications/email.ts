// Provider-independent e-mail delivery.
//   EMAIL_PROVIDER=smtp        SMTP (Mailpit locally: SMTP_HOST=127.0.0.1 SMTP_PORT=1025; any SMTP relay in production)
//   EMAIL_PROVIDER=dev-outbox  stores messages in email_outbox for local development and automated tests.
//                              Refuses to run in production because the body contains the OTP.
// Message bodies (and OTP codes) are never written to logs.
import nodemailer, { type Transporter } from 'nodemailer';
import type { Tx } from '../../lib/scoped-sql.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  template: string;
}

export function emailProvider(): 'smtp' | 'dev-outbox' | 'none' {
  const p = (process.env.EMAIL_PROVIDER || '').trim();
  if (p === 'smtp') return 'smtp';
  if (p === 'dev-outbox') {
    if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_PROVIDER=dev-outbox is not allowed in production');
    return 'dev-outbox';
  }
  return 'none';
}

let transport: Transporter | null = null;
function smtp(): Transporter {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

/** Returns true when the message was accepted by the provider (or stored in the dev outbox). */
export async function sendEmail(tx: Tx, mail: OutgoingEmail): Promise<boolean> {
  const provider = emailProvider();
  if (provider === 'none') return false;
  if (provider === 'dev-outbox') {
    await tx.query(
      `INSERT INTO email_outbox (to_email, subject, body, template, status, provider, sent_at) VALUES ($1,$2,$3,$4,'SENT','dev-outbox',NOW())`,
      [mail.to, mail.subject, mail.text, mail.template],
    );
    return true;
  }
  try {
    await smtp().sendMail({ from: process.env.EMAIL_FROM || 'PLATFORM <no-reply@localhost>', to: mail.to, subject: mail.subject, text: mail.text });
    await tx.query(
      `INSERT INTO email_outbox (to_email, subject, body, template, status, provider, sent_at) VALUES ($1,$2,'[redacted]',$3,'SENT','smtp',NOW())`,
      [mail.to, mail.subject, mail.template],
    );
    return true;
  } catch (error) {
    await tx.query(
      `INSERT INTO email_outbox (to_email, subject, body, template, status, provider, error) VALUES ($1,$2,'[redacted]',$3,'FAILED','smtp',$4)`,
      [mail.to, mail.subject, mail.template, String((error as Error).message).slice(0, 300)],
    );
    return false;
  }
}
