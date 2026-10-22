'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import type { Skipped } from '@/lib/decide-many';
import { editMapping, removeMapping } from '@/lib/dictionary';
import { acceptDictionaryButton } from '@/lib/dictionary-button';
import { admin, writer } from '@/lib/guard';

export type AcceptDictResult = { ok: true; count: number; eventId: string | null; ids: string[]; skipped: Skipped } | { ok: false; error: string };

/** Accepts every pending suggestion that came from the firm dictionary, as one undoable event. */
export async function acceptDictionary(catalogId: unknown): Promise<AcceptDictResult> {
  const { t } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(catalogId);
  if (!user || !id.success) return { ok: false, error: t.errorGeneric };
  const result = await acceptDictionaryButton(user, id.data);
  return result.ok ? result : { ok: false, error: t.errorGeneric };
}

const CODE = z.string().regex(/^\d{17}$/);

/** Points an entry at another code. Only a live classifier code is accepted; it counts as one confirmation. */
export async function updateMapping(payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const { t, ta } = await getI18n();
  const user = await writer();
  const parsed = z.object({ id: z.string().min(1), code: CODE }).safeParse(payload);
  if (!user) return { ok: false, error: t.errorGeneric };
  if (!parsed.success) return { ok: false, error: ta.wsX.dict.codeFormat };
  const result = await editMapping(user, parsed.data.id, parsed.data.code);
  if (!result.ok) return { ok: false, error: result.code === 'not_in_classifier' ? ta.msg.codeNotInClassifier : t.errorGeneric };
  revalidatePath('/dictionary');
  return { ok: true };
}

export async function deleteMapping(id: unknown): Promise<{ ok: boolean; error?: string }> {
  const { t } = await getI18n();
  const user = await writer();
  const parsed = z.string().min(1).safeParse(id);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await removeMapping(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  revalidatePath('/dictionary');
  return { ok: true };
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
