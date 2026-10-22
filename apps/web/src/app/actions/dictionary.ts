'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  acceptDictionaryFor, deleteDictionaryEntry, setDictionaryAutoAccept, updateDictionaryEntry,
} from '@tasnivo/domain/dictionary-ops';
import type { ManyOutcome } from '@tasnivo/domain/workspace-ops';
import { admin, writer } from '@/lib/guard';

export type AcceptDictResult = ManyOutcome;

/** Accepts every pending suggestion that came from the firm dictionary, as one undoable event. */
export async function acceptDictionary(catalogId: unknown): Promise<AcceptDictResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(catalogId);
  if (!user || !id.success) return { ok: false, error: t.errorGeneric };
  return acceptDictionaryFor(user, id.data, locale);
}

/** Points an entry at another code. Only a live classifier code is accepted; it counts as one confirmation. */
export async function updateMapping(payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const { t, ta, locale } = await getI18n();
  const user = await writer();
  const parsed = z.object({ id: z.string().min(1), code: z.string() }).safeParse(payload);
  if (!user) return { ok: false, error: t.errorGeneric };
  if (!parsed.success) return { ok: false, error: ta.wsX.dict.codeFormat };
  const result = await updateDictionaryEntry(user, parsed.data.id, parsed.data.code, locale);
  if (result.ok) revalidatePath('/dictionary');
  return result;
}

export async function deleteMapping(id: unknown): Promise<{ ok: boolean; error?: string }> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = z.string().min(1).safeParse(id);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await deleteDictionaryEntry(user, parsed.data, locale);
  if (result.ok) revalidatePath('/dictionary');
  return result;
}

/** The org setting that accepts dictionary matches automatically. */
export async function setDictAutoAccept(on: unknown): Promise<{ ok: boolean }> {
  const user = await admin();
  const parsed = z.boolean().safeParse(on);
  if (!user || !parsed.success) return { ok: false };
  const result = await setDictionaryAutoAccept(user, parsed.data);
  if (result.ok) revalidatePath('/settings');
  return result;
}
