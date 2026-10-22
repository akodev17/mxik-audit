'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient } from '@tasnivo/domain/access';
import { MAX_UPLOAD_BYTES } from '@tasnivo/domain/catalog-import';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { uploadsOpen } from '@/lib/plan';
import { applyPurchaseMap, clientArchived, deletePurchaseList, PurchaseMapSchema, setClientActivity, storePurchaseList, type PurchaseMap } from '@tasnivo/domain/purchases';
import { parseErrorCode, parseUpload } from '@tasnivo/domain/spreadsheet';

export type ListPreview = { listId: string; filename: string; headers: string[]; rows: string[][]; totalRows: number; totalSeen: number; truncated: boolean };
export type PurchaseUploadResult = { ok: true; preview: ListPreview & { map: PurchaseMap } } | { ok: false; error: string };

/** Stores a purchase file under the client and returns a preview for mapping. */
export async function uploadPurchases(form: FormData): Promise<PurchaseUploadResult> {
  const { t, ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };
  const open = await uploadsOpen(user.orgId);
  if (!open.ok) return { ok: false, error: ta.msg.gate.expired };
  const clientId = form.get('clientId');
  const file = form.get('file');
  if (typeof clientId !== 'string' || !clientId) return { ok: false, error: e.client };
  if (canSeeClient(user, clientId) && await clientArchived(user.orgId, clientId)) return { ok: false, error: e.archived };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: e.none };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };

  let parsed;
  try {
    parsed = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (error) {
    return { ok: false, error: e[parseErrorCode(error)] };
  }
  if (parsed.rows.length === 0) return { ok: false, error: e.empty };
  try {
    const stored = await storePurchaseList(user, { clientId, filename: file.name, parsed });
    if (!stored.ok) return { ok: false, error: e.client };
    return {
      ok: true,
      preview: {
        listId: stored.listId, filename: file.name, headers: parsed.headers, rows: parsed.rows.slice(0, 8),
        totalRows: parsed.rows.length, totalSeen: parsed.totalSeen, truncated: parsed.truncated, map: stored.map,
      },
    };
  } catch {
    return { ok: false, error: e.storeFailed };
  }
}

const ApplyInput = z.object({ listId: z.string().min(1), map: PurchaseMapSchema });

export async function applyPurchases(payload: unknown): Promise<{ ok: true; codes: number } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const parsed = ApplyInput.safeParse(payload);
  if (!user) return { ok: false, error: ta.importX.errors.client };
  if (!parsed.success) return { ok: false, error: ta.importX.errors.badMapping };
  try {
    const result = await applyPurchaseMap(user, parsed.data.listId, parsed.data.map);
    if (!result.ok) return { ok: false, error: result.error === 'no_codes' ? ta.importX.purchases.zeroCodes : ta.importX.errors.notFound };
    revalidatePath('/clients');
    revalidatePath('/catalogs');
    return { ok: true, codes: result.codes };
  } catch {
    return { ok: false, error: ta.importX.lists.saveFailed };
  }
}

export async function removePurchases(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(listId);
  if (!user || !id.success) return { ok: false, error: ta.importX.lists.deleteFailed };
  const ok = await deletePurchaseList(user, id.data).catch(() => false);
  if (!ok) return { ok: false, error: ta.importX.lists.deleteFailed };
  revalidatePath('/clients');
  revalidatePath('/catalogs');
  return { ok: true };
}

const ActivityInput = z.object({ clientId: z.string().min(1), activity: z.enum(['savdo', 'ishlab_chiqarish', 'boshqa']) });

/** "Faoliyat turi": decides whether a sale without a purchase is a high risk. */
export async function setActivity(payload: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const parsed = ActivityInput.safeParse(payload);
  if (!user || !parsed.success || await isDemoOrg(user.orgId)) return { ok: false };
  // A scoped accountant may only change clients assigned to them (setClientActivity checks the org and this again).
  if (!canSeeClient(user, parsed.data.clientId)) return { ok: false };
  const ok = await setClientActivity(user, parsed.data.clientId, parsed.data.activity);
  if (!ok) return { ok: false };
  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath('/catalogs');
  return { ok: true };
}
