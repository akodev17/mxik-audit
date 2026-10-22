'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient, catalogScope } from '@/lib/access';
import { resolveVisibleClient } from '@/lib/active-client';
import { retryAudit, startAudit } from '@/lib/audit-jobs';
import { applyMapping, MAX_UPLOAD_BYTES, storedRows, storeCatalog } from '@/lib/catalog-import';
import { deleteCatalog } from '@/lib/catalogs';
import { ColumnMapSchema, mappingIssues, type MappingIssue } from '@/lib/column-map';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { importDiagnostics, type ImportDiagnostics } from '@/lib/import-diagnostics';
import { suggestMapping } from '@/lib/mapping-memory';
import { gate, previewGate } from '@/lib/plan';
import { discardEarlierPreviews } from '@/lib/preview-sweep';
import { getSession, type CurrentUser } from '@/lib/session';
import { parseErrorCode, parseUpload } from '@/lib/spreadsheet';
import { hasUploadExtension } from '@/lib/upload-file-types';
import { uploadPreview, discardUpload as discardStored, type UploadPreview } from '@/lib/upload-preview';

export type PreviewResult = { ok: true; preview: UploadPreview } | { ok: false; error: string };

type Target = { ok: true; id: string } | { ok: false; reason: 'client' | 'archived' };

/**
 * The client an upload goes to: the org's, one the user may work on, and not
 * archived. Without a name, the client the user is working on.
 */
async function uploadTarget(user: CurrentUser, clientId: string | null): Promise<Target> {
  if (!clientId) {
    const active = await resolveVisibleClient(user);
    return active ? { ok: true, id: active.id } : { ok: false, reason: 'client' };
  }
  if (!canSeeClient(user, clientId)) return { ok: false, reason: 'client' };
  const client = await db.client.findFirst({ where: { id: clientId, orgId: user.orgId }, select: { id: true, archivedAt: true } });
  if (!client) return { ok: false, reason: 'client' };
  return client.archivedAt ? { ok: false, reason: 'archived' } : { ok: true, id: client.id };
}

/**
 * Reads the file once, stores every row as an uncommitted preview and returns
 * what the wizard shows. Changing the mapping later never means re-uploading.
 * The preview does not count against the monthly allowance until committed;
 * it replaces the user's earlier open preview, open previews have their own
 * 24-hour cap, and the daily job deletes any left for 48 hours.
 */
export async function previewUpload(form: FormData): Promise<PreviewResult> {
  const { t, ta } = await getI18n();
  const e = ta.importX.errors;
  const user = await writer();
  if (!user) return { ok: false, error: e.client };
  // Real files never enter a demo org, whatever the browser sends.
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };

  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: e.none };
  // By name as the picker filters; the parser still goes by content for the accepted types.
  if (!hasUploadExtension(file.name)) return { ok: false, error: e.fileType };
  if (file.size === 0) return { ok: false, error: e.zeroBytes };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };

  const requested = form.get('clientId');
  const target = await uploadTarget(user, typeof requested === 'string' && requested ? requested : null);
  if (!target.ok) return { ok: false, error: e[target.reason] };

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

  // One open preview per person: the new file replaces the earlier one, then the org's open rows are capped.
  try {
    await discardEarlierPreviews(user);
  } catch {
    return { ok: false, error: e.storeFailed };
  }
  const room = await previewGate(user.orgId, parsed.rows.length);
  if (!room.ok) return { ok: false, error: e.previewCap(room.cap) };

  try {
    const suggestion = await suggestMapping(user.orgId, target.id, parsed.headers);
    const { catalogId } = await storeCatalog({
      orgId: user.orgId, userId: user.userId, clientId: target.id, filename: file.name, parsed,
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
  // The client may have been archived (or taken from the user) since the preview was made.
  if (!catalog.clientId) return { ok: false, error: e.client };
  const target = await uploadTarget(user, catalog.clientId);
  if (!target.ok) return { ok: false, error: e[target.reason] };

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
