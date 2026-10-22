// Email through SMTP, only when configured. Without SMTP_URL and MAIL_FROM nothing is sent.
import nodemailer from 'nodemailer';

export function mailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env['SMTP_URL']?.trim() && env['MAIL_FROM']?.trim());
}

export type Mail = { to: string; subject: string; text: string };

/**
 * Hands the message to the SMTP server; false when mail is not configured. Throws when sending fails,
 * so the worker's mail queue can retry it.
 */
export async function deliverMail(input: Mail): Promise<boolean> {
  const url = process.env['SMTP_URL']?.trim();
  const from = process.env['MAIL_FROM']?.trim();
  if (!url || !from) return false;
  await nodemailer.createTransport(url).sendMail({ from, to: input.to, subject: input.subject, text: input.text });
  return true;
}

/** True when the message was handed to the SMTP server. Never throws. */
export async function sendMail(input: Mail): Promise<boolean> {
  try {
    return await deliverMail(input);
  } catch (error) {
    console.warn(`[mail] send failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
