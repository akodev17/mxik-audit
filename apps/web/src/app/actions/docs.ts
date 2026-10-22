'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ListPreview } from '@/app/actions/purchases';
import { canSeeClient } from '@tasnivo/domain/access';
import { MAX_UPLOAD_BYTES } from '@tasnivo/domain/catalog-import';
import { applyDocMap, deleteDocList, DocMapSchema, DOC_KINDS, restartDocCheck, storeDocList, type DocKind, type DocMap } from '@tasnivo/domain/docs';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { uploadsOpen } from '@/lib/plan';
import { clientArchived } from '@tasnivo/domain/purchases';
import { parseErrorCode, parseUpload } from '@tasnivo/domain/spreadsheet';

export type DocUploadResult = { ok: true; preview: ListPreview & { map: DocMap } } | { ok: false; error: string };

/** Stores an uploaded list under the client and returns a preview for the column mapping. */
export async function uploadDoc(form: FormData): Promise<DocUploadResult> {
  const { t, ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };
  const open = await uploadsOpen(user.orgId);
  if (!open.ok) return { ok: false, error: ta.msg.gate.expired };
  const clientId = form.get('clientId');
  const kind = DOC_KINDS.find((k) => k === form.get('kind'));
  if (typeof clientId !== 'string' || !clientId || !kind) return { ok: false, error: e.client };
  if (canSeeClient(user, clientId) && await clientArchived(user.orgId, clientId)) return { ok: false, error: e.archived };
  const file = form.get('file');
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
    const stored = await storeDocList(user, { clientId, kind, filename: file.name, parsed });
    if (!stored) return { ok: false, error: e.client };
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

/** Confirms the mapping and starts the check. */
export async function applyDoc(payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const parsed = z.object({ listId: z.string().min(1), map: DocMapSchema }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: ta.importX.docs.startFailed };
  const ok = await applyDocMap(user, parsed.data.listId, parsed.data.map).catch(() => false);
  if (!ok) return { ok: false, error: ta.importX.docs.startFailed };
  revalidatePath('/clients');
  return { ok: true };
}

/** Restarts a failed or stalled check. */
export async function restartDoc(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(listId);
  if (!user || !id.success) return { ok: false, error: ta.importX.docs.restartFailed };
  const ok = await restartDocCheck(user, id.data).catch(() => false);
  return ok ? { ok: true } : { ok: false, error: ta.importX.docs.restartFailed };
}

export async function removeDoc(listId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(listId);
  if (!user || !id.success) return { ok: false, error: ta.importX.lists.deleteFailed };
  const ok = await deleteDocList(user, id.data).catch(() => false);
  if (!ok) return { ok: false, error: ta.importX.lists.deleteFailed };
  revalidatePath('/clients');
  return { ok: true };
}

export type { DocKind };
