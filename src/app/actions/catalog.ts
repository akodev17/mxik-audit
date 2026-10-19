'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient, catalogScope } from '@/lib/access';
import { retryAudit, startAudit } from '@/lib/audit-jobs';
import { applyMapping, MAX_UPLOAD_BYTES, storedRows, storeCatalog } from '@/lib/catalog-import';
import { deleteCatalog } from '@/lib/catalogs';
import { ownedClient } from '@/lib/clients';
import { ColumnMapSchema, mappingIssues, type MappingIssue } from '@/lib/column-map';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { importDiagnostics, type ImportDiagnostics } from '@/lib/import-diagnostics';
import { suggestMapping } from '@/lib/mapping-memory';
import { gate } from '@/lib/plan';
import { getSession } from '@/lib/session';
import { parseErrorCode, parseUpload } from '@/lib/spreadsheet';
import { uploadPreview, discardUpload as discardStored, type UploadPreview } from '@/lib/upload-preview';

export type PreviewResult = { ok: true; preview: UploadPreview } | { ok: false; error: string };

/**
 * Reads the file once, stores every row as an uncommitted preview and returns
 * what the wizard shows. Changing the mapping later never means re-uploading;
 * the preview does not count against the monthly allowance until committed.
 */
export async function previewUpload(form: FormData): Promise<PreviewResult> {
  const { t, ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  // Real files never enter a demo org, whatever the browser sends.
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: e.none };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };

  // A named client must be the org's and one the user may work on.
  const requested = form.get('clientId');
  const client = typeof requested === 'string' && requested ? await ownedClient(user.orgId, requested) : null;
  if (!client || !canSeeClient(user, client.id)) return { ok: false, error: e.client };

  let parsed;
  try {
    parsed = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (error) {
    return { ok: false, error: e[parseErrorCode(error)] };
  }
  if (parsed.rows.length === 0) return { ok: false, error: e.empty };
  // Said now rather than after the mapping; the commit checks again and only then counts the rows.
  const allowed = await gate(user.orgId, 'rowsPerMonth', parsed.rows.length);
  if (!allowed.ok) return { ok: false, error: ta.msg.gate[allowed.reason] };

  try {
    const suggestion = await suggestMapping(user.orgId, client.id, parsed.headers);
    const { catalogId } = await storeCatalog({
      orgId: user.orgId, userId: user.userId, clientId: client.id, filename: file.name, parsed,
      mapping: suggestion.mapping, suggestion: { remembered: suggestion.remembered, fields: suggestion.fields },
    });
    const preview = await uploadPreview(user, catalogId);
    return preview ? { ok: true, preview } : { ok: false, error: e.storeFailed };
  } catch {
    return { ok: false, error: e.storeFailed };
  }
}

const MappingInput = z.object({ catalogId: z.string().min(1), mapping: ColumnMapSchema });

export type DiagnoseResult = { ok: true; diagnostics: ImportDiagnostics; issues: MappingIssue[] } | { ok: false; error: string };

/** Validates a mapping for an uncommitted upload and recomputes its import diagnostics on the server. */
export async function diagnoseUpload(payload: unknown): Promise<DiagnoseResult> {
  const { ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  const input = MappingInput.safeParse(payload);
  if (!input.success) return { ok: false, error: e.badMapping };
  const catalog = await db.catalog.findFirst({
    where: { id: input.data.catalogId, ...catalogScope(user), status: 'uploaded' },
    select: { id: true, headers: true },
  });
  if (!catalog) return { ok: false, error: e.notFound };
  const issues = mappingIssues(input.data.mapping, catalog.headers.length);
  if (issues.length > 0) return { ok: false, error: e.badMapping };
  try {
    return { ok: true, issues, diagnostics: importDiagnostics(await storedRows(catalog.id), input.data.mapping) };
  } catch {
    return { ok: false, error: ta.importX.diag.failed };
  }
}

export type CommitResult = { ok: true; catalogId: string } | { ok: false; error: string; committed?: boolean };

/**
 * Confirms the mapping and starts the audit. The catalogue is claimed
 * atomically, so a double click or a second tab cannot re-derive rows (and lose
 * decisions) of a catalogue that is already being audited. Only the id and the
 * mapping cross the wire; the rows never leave the server.
 */
export async function commitUpload(payload: unknown): Promise<CommitResult> {
  const { t, ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };
  const input = MappingInput.safeParse(payload);
  if (!input.success) return { ok: false, error: e.badMapping };
  const { catalogId, mapping } = input.data;

  // Scoped: a catalogue id alone must not reach another org's or another client's data.
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(user) },
    select: { id: true, clientId: true, status: true, headers: true, rowCount: true },
  });
  if (!catalog) return { ok: false, error: e.notFound };
  if (catalog.status !== 'uploaded') return { ok: false, error: e.alreadyCommitted, committed: true };
  if (mappingIssues(mapping, catalog.headers.length).length > 0) return { ok: false, error: e.badMapping };

  const allowed = await gate(user.orgId, 'rowsPerMonth', catalog.rowCount);
  if (!allowed.ok) return { ok: false, error: ta.msg.gate[allowed.reason] };

  const applied = await applyMapping(user.orgId, catalogId, mapping);
  if ('error' in applied) {
    const message = { not_uploaded: e.alreadyCommitted, bad_mapping: e.badMapping, no_names: e.noNames, failed: e.commitFailed }[applied.error];
    return { ok: false, error: message, ...(applied.error === 'not_uploaded' ? { committed: true } : {}) };
  }

  try {
    // Large catalogues take minutes: the audit runs in the background and the wizard polls its progress.
    await startAudit(catalogId, user, { mapping });
  } catch {
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'failed', auditError: null } }).catch(() => undefined);
    return { ok: false, error: e.startFailed, committed: true };
  }

  // The client just uploaded to is the one being worked on.
  if (catalog.clientId && catalog.clientId !== user.clientId) {
    const session = await getSession();
    session.clientId = catalog.clientId;
    await session.save();
  }
  revalidatePath('/catalogs');
  revalidatePath('/dashboard');
  revalidatePath(`/clients/${catalog.clientId ?? ''}`);
  return { ok: true, catalogId };
}

/** "Start over": deletes an upload that was never committed. */
export async function discardUpload(catalogId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(catalogId);
  if (!user || !id.success) return { ok: false, error: ta.importX.errors.discardFailed };
  const ok = await discardStored(user, id.data);
  return ok ? { ok: true } : { ok: false, error: ta.importX.errors.notFound };
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
  const { t } = await getI18n();
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
