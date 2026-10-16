'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { acceptDictionaryMatches } from '@/lib/dictionary-accept';
import { admin, writer } from '@/lib/guard';

export type AcceptDictResult = { ok: true; count: number } | { ok: false };

/** Accepts every pending suggestion that came from the firm dictionary. */
export async function acceptDictionary(catalogId: unknown): Promise<AcceptDictResult> {
  const user = await writer();
  const id = z.string().min(1).safeParse(catalogId);
  if (!user || !id.success) return { ok: false };
  if (!(await db.catalog.findFirst({ where: { id: id.data, ...catalogScope(user) }, select: { id: true } }))) return { ok: false };
  const result = await acceptDictionaryMatches(user, id.data);
  return { ok: true, count: result.count };
}

const CODE = z.string().regex(/^\d{17}$/);

/** Points an entry at another code. Only a live classifier code is accepted. */
export async function updateMapping(payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const { t, ta } = await getI18n();
  const user = await writer();
  const parsed = z.object({ id: z.string().min(1), code: CODE }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const live = await db.mxikCode.findFirst({ where: { code: parsed.data.code, retiredAt: null }, select: { code: true } });
  if (!live) return { ok: false, error: ta.msg.codeNotInClassifier };
  const done = await db.firmMapping.updateMany({
    where: { id: parsed.data.id, orgId: user.orgId },
    data: { code: parsed.data.code, staleAt: null, updatedBy: user.userId, updatedAt: new Date() },
  });
  if (done.count === 0) return { ok: false, error: t.errorGeneric };
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'dictionary.edited', targetId: parsed.data.id, payload: { code: parsed.data.code } } });
  revalidatePath('/dictionary');
  return { ok: true };
}

export async function deleteMapping(id: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const parsed = z.string().min(1).safeParse(id);
  if (!user || !parsed.success) return { ok: false };
  const done = await db.firmMapping.deleteMany({ where: { id: parsed.data, orgId: user.orgId } });
  if (done.count > 0) {
    await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'dictionary.deleted', targetId: parsed.data, payload: {} } });
  }
  revalidatePath('/dictionary');
  return { ok: done.count > 0 };
}

/** The org setting that accepts dictionary matches automatically. */
export async function setDictAutoAccept(on: unknown): Promise<{ ok: boolean }> {
  const user = await admin();
  const parsed = z.boolean().safeParse(on);
  if (!user || !parsed.success) return { ok: false };
  await db.organization.update({ where: { id: user.orgId }, data: { dictAutoAccept: parsed.data } });
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'dictionary.auto_accept', payload: { on: parsed.data } } });
  revalidatePath('/settings');
  return { ok: true };
}
