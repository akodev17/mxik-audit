// Self-serve accounts: an org on the 14-day trial plus its first admin, and
// email confirmation when SMTP is configured.
import { createHash, randomBytes } from 'node:crypto';
import { absoluteUrl } from './app-url';
import { TRIAL_DAYS } from './billing/limits';
import { db } from './db';
import { mailEnabled, sendMail } from './mailer';
import { hashPassword } from './password';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const TOKEN_HOURS = 48;

export type NewAccount = { userId: string; orgId: string; email: string; needsVerification: boolean };
export type SignupResult = { ok: true; account: NewAccount } | { ok: false; error: string };

export async function createAccount(input: { email: string; password: string; firmName: string; verified?: boolean }): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { ok: false, error: 'Elektron pochta notoʻgʻri.' };
  if (input.password.length < 8) return { ok: false, error: 'Parol kamida 8 belgidan iborat boʻlsin.' };
  const name = input.firmName.replace(/\s+/g, ' ').trim().slice(0, 120) || email.split('@')[0] || 'Firma';
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) return { ok: false, error: 'Bu elektron pochta band. Kirish sahifasidan foydalaning.' };

  const passwordHash = await hashPassword(input.password);
  const needsVerification = mailEnabled() && !input.verified;
  const user = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, kind: 'customer', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) } });
    const created = await tx.user.create({ data: { orgId: org.id, email, passwordHash, role: 'admin', emailVerifiedAt: needsVerification ? null : new Date() } });
    await tx.auditEvent.create({ data: { orgId: org.id, actorId: created.id, action: 'account.created', payload: { via: input.verified ? 'telegram' : 'signup' } } });
    return created;
  });
  if (needsVerification) await sendVerification(user.id, email);
  return { ok: true, account: { userId: user.id, orgId: user.orgId, email, needsVerification } };
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const token = randomBytes(24).toString('base64url');
  await db.emailToken.create({ data: { userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + TOKEN_HOURS * 3_600_000) } });
  await sendMail({ to: email, subject: 'MXIK Audit: elektron pochtani tasdiqlang', text: `Hisobni faollashtirish uchun havolani oching:\n${absoluteUrl(`/verify/${token}`)}\nHavola ${TOKEN_HOURS} soat amal qiladi.` });
}

/** Marks the address confirmed; returns the user to sign in, or null for a bad or used link. */
export async function confirmEmail(token: string): Promise<{ userId: string; orgId: string; email: string } | null> {
  const row = await db.emailToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: { select: { id: true, orgId: true, email: true } } } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  const claimed = await db.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return null;
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  return { userId: row.user.id, orgId: row.user.orgId, email: row.user.email };
}
