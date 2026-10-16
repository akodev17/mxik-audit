'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient, catalogScope } from '@/lib/access';
import { retryAudit, startAudit } from '@/lib/audit-jobs';
import { deleteCatalog } from '@/lib/catalogs';
import { ownedClient, resolveClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { GATE_MESSAGE, gate } from '@/lib/plan';
import { parseUpload } from '@/lib/spreadsheet';
import { getSession } from '@/lib/session';
import { writer } from '@/lib/guard';
import { applyMapping, mappingFor, MAX_UPLOAD_BYTES, storeCatalog } from '@/lib/catalog-import';
import { ColumnMapSchema, type ColumnMap } from '@/lib/column-map';

export type PreviewState = {
  error?: string;
  preview?: {
    /** The catalogue is created up front; the mapping is applied on commit. */
    catalogId: string;
    filename: string;
    headers: string[];
    /** First five rows only — the rest stay on the server. */
    rows: string[][];
    totalRows: number;
    truncated: boolean;
    suggested: ColumnMap;
  };
};

/**
 * Parses the upload, stores every row, and returns a five-row preview. The file
 * is read exactly once: the mapping is applied later against the stored cells,
 * so changing it does not mean re-uploading.
 */
export async function previewUpload(_prev: PreviewState, form: FormData): Promise<PreviewState> {
  const user = await writer();
  if (!user) return { error: t.errorGeneric };
  // Real files never enter a demo org, whatever the browser sends.
  if (await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Fayl tanlanmadi.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Fayl juda katta (20 MB dan oshmasligi kerak).' };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseUpload(buffer, file.name);
    if (parsed.rows.length === 0) return { error: 'Faylda maʼlumot qatorlari topilmadi.' };

    const allowed = await gate(user.orgId, 'rowsPerMonth', parsed.rows.length);
    if (!allowed.ok) return { error: GATE_MESSAGE[allowed.reason] };

    const mapping = await mappingFor(user.orgId, parsed.headers);

    // A named client must be the org's; otherwise the one being worked on.
    const requestedClient = form.get('clientId');
    const client = typeof requestedClient === 'string' && requestedClient
      ? await ownedClient(user.orgId, requestedClient)
      : await resolveClient(user.orgId, user.clientId);
    if (!client || !canSeeClient(user, client.id)) return { error: t.errorGeneric };

    const { catalogId } = await storeCatalog({
      orgId: user.orgId, userId: user.userId, clientId: client.id, filename: file.name, parsed, mapping,
    });

    return {
      preview: {
        catalogId,
        filename: file.name,
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 5),
        totalRows: parsed.rows.length,
        truncated: parsed.truncated,
        suggested: mapping,
      },
    };
  } catch (error) {
    return { error: `Faylni oʻqishda xatolik: ${error instanceof Error ? error.message : ''}` };
  }
}

const CommitInput = z.object({
  catalogId: z.string().min(1),
  mapping: ColumnMapSchema,
});

export type CommitState = { error?: string; catalogId?: string };

/**
 * Applies the confirmed mapping to the stored rows and audits them. Only the
 * catalogue id and the mapping cross the wire — the row data never leaves the
 * server.
 */
export async function commitUpload(payload: unknown): Promise<CommitState> {
  const user = await writer();
  if (!user) return { error: t.errorGeneric };
  if (await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };

  const parsed = CommitInput.safeParse(payload);
  if (!parsed.success) return { error: t.errorGeneric };
  const { catalogId, mapping } = parsed.data;

  // Scope by org: a catalogue id alone must not be enough to reach another org's data.
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(user) },
    select: { id: true, clientId: true },
  });
  if (!catalog) return { error: t.errorGeneric };
  // The client just uploaded to is the one being worked on.
  if (catalog.clientId && catalog.clientId !== user.clientId) {
    const session = await getSession();
    session.clientId = catalog.clientId;
    await session.save();
  }

  const applied = await applyMapping(user.orgId, catalogId, mapping);
  if ('error' in applied) return { error: applied.error };

  // Large catalogues take minutes, so the audit runs in the background and the
  // report shows its progress; the request returns as soon as rows are stored.
  await startAudit(catalogId, user, { mapping });

  revalidatePath('/report');
  revalidatePath('/review');
  revalidatePath('/export');
  revalidatePath('/catalogs');
  return { catalogId };
}

/** Restarts an audit that failed. */
export async function retryCatalogAudit(catalogId: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  if (!user) return { ok: false };
  const id = z.string().min(1).safeParse(catalogId);
  if (!id.success) return { ok: false };
  const ok = await retryAudit(user, id.data);
  revalidatePath('/report');
  return { ok };
}

export type RemoveResult = { ok: true; rows: number } | { ok: false; error: string };

/** Deletes one of the org's catalogues and everything derived from it. */
export async function removeCatalog(catalogId: unknown): Promise<RemoveResult> {
  const user = await writer();
  if (!user) return { ok: false, error: t.errorGeneric };
  const id = z.string().min(1).safeParse(catalogId);
  if (!id.success) return { ok: false, error: t.errorGeneric };

  const result = await deleteCatalog(user, id.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  revalidatePath('/catalogs');
  revalidatePath('/report');
  revalidatePath('/review');
  revalidatePath('/export');
  return { ok: true, rows: result.rows };
}
