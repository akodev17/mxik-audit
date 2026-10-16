// Invite links. Only a hash of the token is stored; the link is shown once.
import { createHash, randomBytes } from 'node:crypto';
import { absoluteUrl } from './app-url';
import { db } from './db';
import { mailEnabled, sendMail } from './mailer';
import { hashPassword } from './password';
import type { Role } from './session';

export const INVITE_DAYS = 7;
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

type Actor = { userId: string; orgId: string };

export async function createInvite(
  actor: Actor, input: { email: string | null; role: Role; clientIds: string[] },
): Promise<{ url: string; emailed: boolean }> {
  const token = randomBytes(24).toString('base64url');
  // Only the org's own clients can be attached.
  const owned = input.clientIds.length === 0 ? [] : (await db.client.findMany({
    where: { orgId: actor.orgId, id: { in: input.clientIds } }, select: { id: true },
  })).map((c) => c.id);
  await db.invite.create({
    data: {
      orgId: actor.orgId, tokenHash: hash(token), email: input.email, role: input.role, clientIds: owned,
      createdBy: actor.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'team.invited', payload: { role: input.role, email: input.email, clients: owned.length } },
  });
  const url = absoluteUrl(`/invite/${token}`);
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true } });
  const name = org?.name ?? 'MXIK Audit';
  const emailed = input.email && mailEnabled()
    ? await sendMail({ to: input.email, subject: `${name}: taklifnoma`, text: `Sizni ${name} jamoasiga taklif qilishdi.\nQabul qilish: ${url}\nHavola ${INVITE_DAYS} kun amal qiladi.` })
    : false;
  return { url, emailed };
}

export type InviteView = { orgName: string; role: Role; email: string | null };

/** The invite behind a token, when it is still usable. */
export async function readInvite(token: string): Promise<InviteView | null> {
  const invite = await db.invite.findUnique({ where: { tokenHash: hash(token) }, include: { org: { select: { name: true } } } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;
  return { orgName: invite.org.name, role: invite.role, email: invite.email };
}

export type AcceptResult = { ok: true; userId: string; orgId: string; email: string } | { ok: false; error: string };

export async function acceptInvite(token: string, emailInput: string, password: string): Promise<AcceptResult> {
  const invite = await db.invite.findUnique({ where: { tokenHash: hash(token) } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return { ok: false, error: 'Taklifnoma muddati tugagan yoki ishlatilgan.' };
  const email = (invite.email ?? emailInput).trim().toLowerCase();
  if (invite.email && emailInput.trim().toLowerCase() !== invite.email.toLowerCase()) {
    return { ok: false, error: 'Taklifnoma boshqa elektron pochta uchun berilgan.' };
  }
  if (password.length < 8) return { ok: false, error: 'Parol kamida 8 belgidan iborat boʻlsin.' };
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) return { ok: false, error: 'Bu elektron pochta band. Kirish sahifasidan foydalaning.' };

  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    // The claim is atomic, so one link creates one account.
    const claimed = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error('used');
    const created = await tx.user.create({ data: { orgId: invite.orgId, email, passwordHash, role: invite.role } });
    if (invite.role !== 'admin' && invite.clientIds.length > 0) {
      await tx.clientAssignment.createMany({ data: invite.clientIds.map((clientId) => ({ userId: created.id, clientId })), skipDuplicates: true });
    }
    await tx.auditEvent.create({ data: { orgId: invite.orgId, actorId: created.id, action: 'team.joined', payload: { role: invite.role, email } } });
    return created;
  }).catch(() => null);
  if (!user) return { ok: false, error: 'Taklifnoma ishlatilgan.' };
  return { ok: true, userId: user.id, orgId: user.orgId, email };
}
