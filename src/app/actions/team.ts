'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formText } from '@/lib/form';
import { admin } from '@/lib/guard';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { acceptInvite, createInvite } from '@/lib/invites';
import { getSession } from '@/lib/session';

const RoleSchema = z.enum(['admin', 'accountant', 'viewer']);

export type InviteState = { error?: string; url?: string; emailed?: boolean };

/** Admin creates an invite link; emailed too when SMTP is configured. */
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: t.errorGeneric };
  const role = RoleSchema.safeParse(form.get('role'));
  const email = z.string().email().max(200).safeParse(formText(form, 'email').trim());
  if (!role.success) return { error: t.errorGeneric };
  const clientIds = form.getAll('clientIds').filter((v): v is string => typeof v === 'string');
  const result = await createInvite(user, { email: email.success ? email.data.toLowerCase() : null, role: role.data, clientIds });
  revalidatePath('/settings');
  return result;
}

/** Changes a member's role and clients. The last admin cannot be demoted. */
export async function updateMember(payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await admin();
  const parsed = z.object({ userId: z.string().min(1), role: RoleSchema, clientIds: z.array(z.string()).max(500) }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const target = await db.user.findFirst({ where: { id: parsed.data.userId, orgId: user.orgId }, select: { id: true, role: true } });
  if (!target) return { ok: false, error: t.errorGeneric };
  if (target.role === 'admin' && parsed.data.role !== 'admin' && await db.user.count({ where: { orgId: user.orgId, role: 'admin' } }) <= 1) {
    return { ok: false, error: 'Kamida bitta administrator qolishi kerak.' };
  }
  const owned = (await db.client.findMany({ where: { orgId: user.orgId, id: { in: parsed.data.clientIds } }, select: { id: true } })).map((c) => c.id);
  await db.$transaction([
    db.user.update({ where: { id: target.id }, data: { role: parsed.data.role } }),
    db.clientAssignment.deleteMany({ where: { userId: target.id } }),
    db.clientAssignment.createMany({ data: parsed.data.role === 'admin' ? [] : owned.map((clientId) => ({ userId: target.id, clientId })) }),
    db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'team.updated', targetId: target.id, payload: { role: parsed.data.role, clients: owned.length } } }),
  ]);
  revalidatePath('/settings');
  return { ok: true };
}

export async function removeMember(userId: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await admin();
  const id = z.string().min(1).safeParse(userId);
  if (!user || !id.success || id.data === user.userId) return { ok: false, error: t.errorGeneric };
  const target = await db.user.findFirst({ where: { id: id.data, orgId: user.orgId }, select: { id: true, email: true } });
  if (!target) return { ok: false, error: t.errorGeneric };
  await db.$transaction([
    db.user.delete({ where: { id: target.id } }),
    db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'team.removed', targetId: target.id, payload: { email: target.email } } }),
  ]);
  revalidatePath('/settings');
  return { ok: true };
}

export async function revokeInvite(inviteId: unknown): Promise<{ ok: boolean }> {
  const user = await admin();
  const id = z.string().min(1).safeParse(inviteId);
  if (!user || !id.success) return { ok: false };
  await db.invite.deleteMany({ where: { id: id.data, orgId: user.orgId, usedAt: null } });
  revalidatePath('/settings');
  return { ok: true };
}

export type JoinState = { error?: string };

/** Public: accepts an invite, creates the account and signs it in. */
export async function joinWithInvite(token: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  const result = await acceptInvite(token, formText(form, 'email'), formText(form, 'password'));
  if (!result.ok) return { error: result.error };
  const session = await getSession();
  session.userId = result.userId;
  session.orgId = result.orgId;
  session.email = result.email;
  session.demo = false;
  session.clientId = undefined;
  await session.save();
  redirect('/catalogs');
}
