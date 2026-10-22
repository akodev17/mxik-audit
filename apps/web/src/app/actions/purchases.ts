'use server';

// A client's purchase lists and activity type. The rules and messages live in
// @tasnivo/domain/list-upload (shared with the API); these add the session and the cache.
import { getLocale } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { writer } from '@/lib/guard';
import {
  applyPurchaseFile, removePurchaseFile, setActivityFor, uploadPurchaseFile, type ListPreview, type PurchaseUploadResult,
} from '@tasnivo/domain/list-upload';
import { formFile } from '@tasnivo/domain/catalog-upload';

export type { ListPreview, PurchaseUploadResult };

/** Stores a purchase file under the client and returns a preview for mapping. */
export async function uploadPurchases(form: FormData): Promise<PurchaseUploadResult> {
  return uploadPurchaseFile(await writer(), await getLocale(), { clientId: form.get('clientId'), file: formFile(form.get('file')) });
}

export async function applyPurchases(payload: unknown): Promise<{ ok: true; codes: number } | { ok: false; error: string }> {
  const result = await applyPurchaseFile(await writer(), await getLocale(), payload);
  if (result.ok) {
    revalidatePath('/clients');
    revalidatePath('/catalogs');
  }
  return result;
}

export async function removePurchases(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await removePurchaseFile(await writer(), await getLocale(), listId);
  if (result.ok) {
    revalidatePath('/clients');
    revalidatePath('/catalogs');
  }
  return result;
}

/** "Faoliyat turi": decides whether a sale without a purchase is a high risk. */
export async function setActivity(payload: unknown): Promise<{ ok: boolean }> {
  const result = await setActivityFor(await writer(), payload);
  if (result.ok) {
    const clientId = (payload as { clientId: string }).clientId;
    revalidatePath(`/clients/${clientId}`);
    revalidatePath('/catalogs');
  }
  return result;
}
