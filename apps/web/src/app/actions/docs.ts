'use server';

// A client's cheque and sales lists. The rules and messages live in
// @tasnivo/domain/list-upload (shared with the API); these add the session and the cache.
import { revalidatePath } from 'next/cache';
import { formFile } from '@tasnivo/domain/catalog-upload';
import type { DocKind } from '@tasnivo/domain/docs';
import { applyDocFile, removeDocFile, restartDocFile, uploadDocFile, type DocUploadResult } from '@tasnivo/domain/list-upload';
import { writer } from '@/lib/guard';
import { getLocale } from '@/lib/locale';

export type { DocUploadResult };

/** Stores an uploaded list under the client and returns a preview for the column mapping. */
export async function uploadDoc(form: FormData): Promise<DocUploadResult> {
  return uploadDocFile(await writer(), await getLocale(), { clientId: form.get('clientId'), kind: form.get('kind'), file: formFile(form.get('file')) });
}

/** Confirms the mapping and starts the check. */
export async function applyDoc(payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await applyDocFile(await writer(), await getLocale(), payload);
  if (result.ok) revalidatePath('/clients');
  return result;
}

/** Restarts a failed or stalled check. */
export async function restartDoc(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return restartDocFile(await writer(), await getLocale(), listId);
}

export async function removeDoc(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await removeDocFile(await writer(), await getLocale(), listId);
  if (result.ok) revalidatePath('/clients');
  return result;
}

export type { DocKind };
