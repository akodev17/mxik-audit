// The upload wizard's steps (preview → diagnose → commit, discard, retry) and catalogue deletion,
// with the refusals the user reads. The web app's server actions and the API's catalogs module
// both call these, so the rules and the messages cannot drift apart. `user` is the caller once the
// writer guard passed, or null when it did not (the action's writer() result): every function
// answers that, a viewer and a demo org the way the actions always did.
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import { canSeeClient, canWrite, catalogScope } from './access.js';
import { resolveVisibleClient } from './active-client.js';
import { retryAudit, startAudit } from './audit-jobs.js';
import { applyMapping, MAX_UPLOAD_BYTES, storedRows, storeCatalog } from './catalog-import.js';
import { deleteCatalog } from './catalogs.js';
import { ColumnMapSchema, mappingIssues, type MappingIssue } from './column-map.js';
import { isDemoOrg } from './demo.js';
import { importDiagnostics, type ImportDiagnostics } from './import-diagnostics.js';
import { suggestMapping } from './mapping-memory.js';
import { gate, previewGate } from './plan.js';
import { discardEarlierPreviews } from './preview-sweep.js';
import type { CurrentUser } from './session.js';
import { parseErrorCode, parseUpload } from './spreadsheet.js';
import { hasUploadExtension } from './upload-file-types.js';
import { discardUpload as discardStored, uploadPreview, type UploadPreview } from './upload-preview.js';

/** An uploaded file as either side receives it: the web's File, the API's multipart part. */
export type UploadedFile = { name: string; size: number; read: () => Promise<Buffer> };

/** A FormData entry as an UploadedFile; null when it is not a file. */
export function formFile(value: unknown): UploadedFile | null {
  return value instanceof File ? { name: value.name, size: value.size, read: async () => Buffer.from(await value.arrayBuffer()) } : null;
}

type Writer = CurrentUser | null;

const allowed = (user: Writer): user is CurrentUser => user !== null && canWrite(user);

type Target = { ok: true; id: string } | { ok: false; reason: 'client' | 'archived' };

/**
 * The client an upload goes to: the org's, one the user may work on, and not
 * archived. Without a name, the client the user is working on.
 */
export async function uploadTarget(user: CurrentUser, clientId: string | null): Promise<Target> {
  if (!clientId) {
    const active = await resolveVisibleClient(user);
    return active ? { ok: true, id: active.id } : { ok: false, reason: 'client' };
  }
  if (!canSeeClient(user, clientId)) return { ok: false, reason: 'client' };
  const client = await db.client.findFirst({ where: { id: clientId, orgId: user.orgId }, select: { id: true, archivedAt: true } });
  if (!client) return { ok: false, reason: 'client' };
  return client.archivedAt ? { ok: false, reason: 'archived' } : { ok: true, id: client.id };
}

export type PreviewResult = { ok: true; preview: UploadPreview } | { ok: false; error: string };

/**
 * Reads the file once, stores every row as an uncommitted preview and returns
 * what the wizard shows. Changing the mapping later never means re-uploading.
 * The preview does not count against the monthly allowance until committed;
 * it replaces the user's earlier open preview, open previews have their own
 * 24-hour cap, and the daily job deletes any left for 48 hours.
 */
export async function previewCatalogUpload(
  user: Writer, locale: Locale, input: { file: UploadedFile | null; clientId: string | null },
): Promise<PreviewResult> {
  const { t, ta } = i18nFor(locale);
  const e = ta.importX.errors;
  if (!allowed(user)) return { ok: false, error: e.client };
  // Real files never enter a demo org, whatever the browser sends.
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };

  const { file } = input;
  if (!file) return { ok: false, error: e.none };
  // By name as the picker filters; the parser still goes by content for the accepted types.
  if (!hasUploadExtension(file.name)) return { ok: false, error: e.fileType };
  if (file.size === 0) return { ok: false, error: e.zeroBytes };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };

  const target = await uploadTarget(user, input.clientId || null);
  if (!target.ok) return { ok: false, error: e[target.reason] };

  let parsed;
  try {
    parsed = await parseUpload(await file.read(), file.name);
  } catch (error) {
    return { ok: false, error: e[parseErrorCode(error)] };
  }
  if (parsed.rows.length === 0) return { ok: false, error: e.empty };
  // Said now rather than after the mapping; the commit checks again and only then counts the rows.
  const rows = await gate(user.orgId, 'rowsPerMonth', parsed.rows.length);
  if (!rows.ok) return { ok: false, error: ta.msg.gate[rows.reason] };

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
export async function diagnoseCatalogUpload(user: Writer, locale: Locale, payload: unknown): Promise<DiagnoseResult> {
  const { ta } = i18nFor(locale);
  const e = ta.importX.errors;
  if (!allowed(user)) return { ok: false, error: e.client };
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
 * The commit's answer and, on success, the catalogue's client: the client just uploaded to is the
 * one being worked on, so the caller makes it the session's active client when it is not already.
 */
export type Committed = { result: CommitResult; clientId: string | null };

/**
 * Confirms the mapping and starts the audit. The catalogue is claimed
 * atomically, so a double click or a second tab cannot re-derive rows (and lose
 * decisions) of a catalogue that is already being audited. Only the id and the
 * mapping cross the wire; the rows never leave the server. The audit itself goes
 * to jobs(): in-process by default, to the worker with JOBS_MODE=bullmq.
 */
export async function commitCatalogUpload(user: Writer, locale: Locale, payload: unknown): Promise<Committed> {
  const { t, ta } = i18nFor(locale);
  const e = ta.importX.errors;
  const fail = (error: string, committed?: boolean): Committed => ({ result: { ok: false, error, ...(committed ? { committed } : {}) }, clientId: null });
  if (!allowed(user)) return fail(e.client);
  if (await isDemoOrg(user.orgId)) return fail(t.demoUploadDisabled);
  const input = MappingInput.safeParse(payload);
  if (!input.success) return fail(e.badMapping);
  const { catalogId, mapping } = input.data;

  // Scoped: a catalogue id alone must not reach another org's or another client's data.
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(user) },
    select: { id: true, clientId: true, status: true, headers: true, rowCount: true },
  });
  if (!catalog) return fail(e.notFound);
  if (catalog.status !== 'uploaded') return fail(e.alreadyCommitted, true);
  if (mappingIssues(mapping, catalog.headers.length).length > 0) return fail(e.badMapping);
  // The client may have been archived (or taken from the user) since the preview was made.
  if (!catalog.clientId) return fail(e.client);
  const target = await uploadTarget(user, catalog.clientId);
  if (!target.ok) return fail(e[target.reason]);

  const rows = await gate(user.orgId, 'rowsPerMonth', catalog.rowCount);
  if (!rows.ok) return fail(ta.msg.gate[rows.reason]);

  const applied = await applyMapping(user.orgId, catalogId, mapping);
  if ('error' in applied) {
    const message = { not_uploaded: e.alreadyCommitted, bad_mapping: e.badMapping, no_names: e.noNames, failed: e.commitFailed }[applied.error];
    return fail(message, applied.error === 'not_uploaded');
  }

  try {
    // Large catalogues take minutes: the audit runs in the background and the wizard polls its progress.
    await startAudit(catalogId, user, { mapping });
  } catch {
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'failed', auditError: null } }).catch(() => undefined);
    return fail(e.startFailed, true);
  }
  return { result: { ok: true, catalogId }, clientId: catalog.clientId };
}

/** "Start over": deletes an upload that was never committed. */
export async function discardCatalogUpload(user: Writer, locale: Locale, catalogId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ta } = i18nFor(locale);
  const id = z.string().min(1).safeParse(catalogId);
  if (!allowed(user) || !id.success) return { ok: false, error: ta.importX.errors.discardFailed };
  const ok = await discardStored(user, id.data);
  return ok ? { ok: true } : { ok: false, error: ta.importX.errors.notFound };
}

/** Restarts an audit that failed. */
export async function retryCatalogAudit(user: Writer, catalogId: unknown): Promise<{ ok: boolean }> {
  if (!allowed(user)) return { ok: false };
  const id = z.string().min(1).safeParse(catalogId);
  if (!id.success) return { ok: false };
  return { ok: await retryAudit(user, id.data) };
}

export type RemoveResult = { ok: true; rows: number } | { ok: false; error: string };

/** Deletes one of the org's catalogues and everything derived from it. */
export async function removeCatalogFor(user: Writer, locale: Locale, catalogId: unknown): Promise<RemoveResult> {
  const { t } = i18nFor(locale);
  if (!allowed(user)) return { ok: false, error: t.errorGeneric };
  const id = z.string().min(1).safeParse(catalogId);
  if (!id.success) return { ok: false, error: t.errorGeneric };
  const result = await deleteCatalog(user, id.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  return { ok: true, rows: result.rows };
}
