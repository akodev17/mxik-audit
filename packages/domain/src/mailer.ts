// Email through SMTP when SMTP_URL and MAIL_FROM are set. Without them, outside production, every
// message is written to the log and to tmp/outbox/ instead (so sign-up codes can be read while
// developing and by the tests); in production nothing is sent and mailDeliverable() is false.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';

type Env = Record<string, string | undefined>;

/** SMTP is configured: real mail goes out. */
export function mailEnabled(env: Env = process.env): boolean {
  return Boolean(env['SMTP_URL']?.trim() && env['MAIL_FROM']?.trim());
}

/** 'smtp': real delivery; 'outbox': the development fallback (log + tmp/outbox); 'off': production without SMTP. */
export type MailMode = 'smtp' | 'outbox' | 'off';

export function mailMode(env: Env = process.env): MailMode {
  if (mailEnabled(env)) return 'smtp';
  return env['NODE_ENV'] === 'production' ? 'off' : 'outbox';
}

/** A message the user must read (a verification code) can reach them: SMTP, or the development outbox. */
export const mailDeliverable = (env: Env = process.env): boolean => mailMode(env) !== 'off';

/** Where the development fallback writes; MAIL_OUTBOX_DIR overrides it. */
export const outboxDir = (env: Env = process.env): string => env['MAIL_OUTBOX_DIR']?.trim() || join(process.cwd(), 'tmp', 'outbox');

export type Mail = { to: string; subject: string; text: string };

let outboxSeq = 0;

/** One file per message, named so a directory listing sorts by time: tmp/outbox/<timestamp>-<n>.txt. */
async function writeOutbox(input: Mail): Promise<void> {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}-${process.pid}-${outboxSeq++}.txt`);
  await writeFile(file, `To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}\n`, 'utf8');
  console.info(`[mail] SMTP is not configured; written to ${file}\n[mail] To: ${input.to} | ${input.subject}\n${input.text}`);
}

/**
 * Hands the message to the SMTP server (or the development outbox); false when mail is off.
 * Throws when sending fails, so the worker's mail queue can retry it.
 */
export async function deliverMail(input: Mail): Promise<boolean> {
  const mode = mailMode();
  if (mode === 'off') return false;
  if (mode === 'outbox') {
    await writeOutbox(input);
    return true;
  }
  const url = process.env['SMTP_URL']?.trim() ?? '';
  const from = process.env['MAIL_FROM']?.trim() ?? '';
  await nodemailer.createTransport(url).sendMail({ from, to: input.to, subject: input.subject, text: input.text });
  return true;
}

/** True when the message was handed to the SMTP server (or the outbox). Never throws. */
export async function sendMail(input: Mail): Promise<boolean> {
  try {
    return await deliverMail(input);
  } catch (error) {
    console.warn(`[mail] send failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
