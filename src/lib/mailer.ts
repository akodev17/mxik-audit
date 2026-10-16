// Email through SMTP, only when configured. Without SMTP_URL and MAIL_FROM nothing is sent.
import nodemailer from 'nodemailer';

export function mailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env['SMTP_URL']?.trim() && env['MAIL_FROM']?.trim());
}

/** True when the message was handed to the SMTP server. */
export async function sendMail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const url = process.env['SMTP_URL']?.trim();
  const from = process.env['MAIL_FROM']?.trim();
  if (!url || !from) return false;
  try {
    await nodemailer.createTransport(url).sendMail({ from, to: input.to, subject: input.subject, text: input.text });
    return true;
  } catch (error) {
    console.warn(`[mail] send failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
