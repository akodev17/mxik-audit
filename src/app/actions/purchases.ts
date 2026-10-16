'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '@/lib/catalog-import';
import { ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { applyPurchaseMap, deletePurchaseList, PurchaseMapSchema, recheckClientPurchases, storePurchaseList, type PurchaseMap } from '@/lib/purchases';
import { currentUser } from '@/lib/session';
import { parseUpload } from '@/lib/spreadsheet';

export type PurchaseUploadState = {
  error?: string;
  preview?: { listId: string; filename: string; headers: string[]; rows: string[][]; totalRows: number; map: PurchaseMap };
};

/** Stores a purchase file under the client and returns a preview for mapping. */
export async function uploadPurchases(_prev: PurchaseUploadState, form: FormData): Promise<PurchaseUploadState> {
  const user = await currentUser();
  if (!user || await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };
  const clientId = form.get('clientId');
  const client = typeof clientId === 'string' ? await ownedClient(user.orgId, clientId) : null;
  if (!client) return { error: t.errorGeneric };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Fayl tanlanmadi.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Fayl juda katta (20 MB dan oshmasligi kerak).' };

  try {
    const parsed = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name);
    if (parsed.rows.length === 0) return { error: 'Faylda maʼlumot qatorlari topilmadi.' };
    const { listId, map } = await storePurchaseList({ orgId: user.orgId, clientId: client.id, filename: file.name, parsed });
    await db.auditEvent.create({
      data: {
        orgId: user.orgId, actorId: user.userId, action: 'purchases.uploaded', targetId: listId,
        payload: { clientId: client.id, filename: file.name, rowCount: parsed.rows.length },
      },
    });
    return { preview: { listId, filename: file.name, headers: parsed.headers, rows: parsed.rows.slice(0, 5), totalRows: parsed.rows.length, map } };
  } catch (error) {
    return { error: `Faylni oʻqishda xatolik: ${error instanceof Error ? error.message : ''}` };
  }
}

const ApplyInput = z.object({ listId: z.string().min(1), map: PurchaseMapSchema });

export async function applyPurchases(payload: unknown): Promise<{ ok: true; codes: number } | { ok: false; error: string }> {
  const user = await currentUser();
  const parsed = ApplyInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await applyPurchaseMap(user.orgId, parsed.data.listId, parsed.data.map);
  if (!result) return { ok: false, error: t.errorGeneric };
  revalidatePath('/clients');
  revalidatePath('/report');
  revalidatePath('/review');
  return { ok: true, codes: result.codes };
}

export async function removePurchases(listId: unknown): Promise<{ ok: boolean }> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(listId);
  if (!user || !id.success) return { ok: false };
  const ok = await deletePurchaseList(user.orgId, id.data);
  revalidatePath('/clients');
  revalidatePath('/report');
  return { ok };
}

const ActivityInput = z.object({ clientId: z.string().min(1), activity: z.enum(['savdo', 'ishlab_chiqarish', 'boshqa']) });

/** "Faoliyat turi": decides whether a sale without a purchase is a high risk. */
export async function setActivity(payload: unknown): Promise<{ ok: boolean }> {
  const user = await currentUser();
  const parsed = ActivityInput.safeParse(payload);
  if (!user || !parsed.success || await isDemoOrg(user.orgId)) return { ok: false };
  const client = await ownedClient(user.orgId, parsed.data.clientId);
  if (!client) return { ok: false };
  await db.client.update({ where: { id: client.id }, data: { activity: parsed.data.activity } });
  await db.auditEvent.create({
    data: { orgId: user.orgId, actorId: user.userId, action: 'client.activity_set', targetId: client.id, payload: { clientId: client.id, activity: parsed.data.activity } },
  });
  await recheckClientPurchases(user.orgId, client.id);
  revalidatePath(`/clients/${client.id}`);
  revalidatePath('/report');
  return { ok: true };
}
