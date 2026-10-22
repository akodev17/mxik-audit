// A client's purchase lists and cheque / sales lists: upload, map, restart, remove, and the
// client's activity type, with the refusals the user reads. The web's purchases and docs actions
// and the API's imports module both call these. `user` is the caller once the writer guard
// passed, or null when it did not.
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { canSeeClient, canWrite } from './access.js';
import { MAX_UPLOAD_BYTES } from './catalog-import.js';
import type { UploadedFile } from './catalog-upload.js';
import { isDemoOrg } from './demo.js';
import { applyDocMap, deleteDocList, DocMapSchema, DOC_KINDS, restartDocCheck, storeDocList, type DocKind, type DocMap } from './docs.js';
import { uploadsOpen } from './plan.js';
import { applyPurchaseMap, clientArchived, deletePurchaseList, PurchaseMapSchema, setClientActivity, storePurchaseList, type PurchaseMap } from './purchases.js';
import type { CurrentUser } from './session.js';
import { parseErrorCode, parseUpload, type ParseResult } from './spreadsheet.js';

type Writer = CurrentUser | null;
type Fail = { ok: false; error: string };

const allowed = (user: Writer): user is CurrentUser => user !== null && canWrite(user);

export type ListPreview = { listId: string; filename: string; headers: string[]; rows: string[][]; totalRows: number; totalSeen: number; truncated: boolean };
export type PurchaseUploadResult = { ok: true; preview: ListPreview & { map: PurchaseMap } } | Fail;
export type DocUploadResult = { ok: true; preview: ListPreview & { map: DocMap } } | Fail;

const preview = (listId: string, filename: string, parsed: ParseResult): ListPreview => ({
  listId, filename, headers: parsed.headers, rows: parsed.rows.slice(0, 8),
  totalRows: parsed.rows.length, totalSeen: parsed.totalSeen, truncated: parsed.truncated,
});

/**
 * The checks both list uploads make before storing, in the actions' order: writer, demo, plan,
 * client (then archived), file. Answers the parsed file or the refusal.
 */
async function readListFile(user: Writer, locale: Locale, clientId: unknown, file: UploadedFile | null, valid: boolean): Promise<{ ok: true; user: CurrentUser; clientId: string; parsed: ParseResult; file: UploadedFile } | Fail> {
  const { t, ta } = i18nFor(locale);
  const e = ta.importX.errors;
  if (!allowed(user)) return { ok: false, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: t.demoUploadDisabled };
  const open = await uploadsOpen(user.orgId);
  if (!open.ok) return { ok: false, error: ta.msg.gate.expired };
  if (typeof clientId !== 'string' || !clientId || !valid) return { ok: false, error: e.client };
  if (canSeeClient(user, clientId) && await clientArchived(user.orgId, clientId)) return { ok: false, error: e.archived };
  if (!file || file.size === 0) return { ok: false, error: e.none };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };
  let parsed;
  try {
    parsed = await parseUpload(await file.read(), file.name);
  } catch (error) {
    return { ok: false, error: e[parseErrorCode(error)] };
  }
  if (parsed.rows.length === 0) return { ok: false, error: e.empty };
  return { ok: true, user, clientId, parsed, file };
}

/** Stores a purchase file under the client and returns a preview for mapping. */
export async function uploadPurchaseFile(user: Writer, locale: Locale, input: { clientId: unknown; file: UploadedFile | null }): Promise<PurchaseUploadResult> {
  const e = i18nFor(locale).ta.importX.errors;
  const read = await readListFile(user, locale, input.clientId, input.file, true);
  if (!read.ok) return read;
  try {
    const stored = await storePurchaseList(read.user, { clientId: read.clientId, filename: read.file.name, parsed: read.parsed });
    if (!stored.ok) return { ok: false, error: e.client };
    return { ok: true, preview: { ...preview(stored.listId, read.file.name, read.parsed), map: stored.map } };
  } catch {
    return { ok: false, error: e.storeFailed };
  }
}

const ApplyPurchases = z.object({ listId: z.string().min(1), map: PurchaseMapSchema });

export async function applyPurchaseFile(user: Writer, locale: Locale, payload: unknown): Promise<{ ok: true; codes: number } | Fail> {
  const { ta } = i18nFor(locale);
  const parsed = ApplyPurchases.safeParse(payload);
  if (!allowed(user)) return { ok: false, error: ta.importX.errors.client };
  if (!parsed.success) return { ok: false, error: ta.importX.errors.badMapping };
  try {
    const result = await applyPurchaseMap(user, parsed.data.listId, parsed.data.map);
    if (!result.ok) return { ok: false, error: result.error === 'no_codes' ? ta.importX.purchases.zeroCodes : ta.importX.errors.notFound };
    return { ok: true, codes: result.codes };
  } catch {
    return { ok: false, error: ta.importX.lists.saveFailed };
  }
}

export async function removePurchaseFile(user: Writer, locale: Locale, listId: unknown): Promise<{ ok: true } | Fail> {
  const { ta } = i18nFor(locale);
  const id = z.string().min(1).safeParse(listId);
  if (!allowed(user) || !id.success) return { ok: false, error: ta.importX.lists.deleteFailed };
  const ok = await deletePurchaseList(user, id.data).catch(() => false);
  return ok ? { ok: true } : { ok: false, error: ta.importX.lists.deleteFailed };
}

const ActivityInput = z.object({ clientId: z.string().min(1), activity: z.enum(['savdo', 'ishlab_chiqarish', 'boshqa']) });

/** "Faoliyat turi": decides whether a sale without a purchase is a high risk. */
export async function setActivityFor(user: Writer, payload: unknown): Promise<{ ok: boolean }> {
  const parsed = ActivityInput.safeParse(payload);
  if (!allowed(user) || !parsed.success || await isDemoOrg(user.orgId)) return { ok: false };
  // A scoped accountant may only change clients assigned to them (setClientActivity checks the org and this again).
  if (!canSeeClient(user, parsed.data.clientId)) return { ok: false };
  return { ok: await setClientActivity(user, parsed.data.clientId, parsed.data.activity) };
}

/** Stores an uploaded cheque or sales list under the client and returns a preview for the column mapping. */
export async function uploadDocFile(user: Writer, locale: Locale, input: { clientId: unknown; kind: unknown; file: UploadedFile | null }): Promise<DocUploadResult> {
  const e = i18nFor(locale).ta.importX.errors;
  const kind: DocKind | undefined = DOC_KINDS.find((k) => k === input.kind);
  const read = await readListFile(user, locale, input.clientId, input.file, kind !== undefined);
  if (!read.ok) return read;
  if (!kind) return { ok: false, error: e.client }; // readListFile refused it already; narrows the type
  try {
    const stored = await storeDocList(read.user, { clientId: read.clientId, kind, filename: read.file.name, parsed: read.parsed });
    if (!stored) return { ok: false, error: e.client };
    return { ok: true, preview: { ...preview(stored.listId, read.file.name, read.parsed), map: stored.map } };
  } catch {
    return { ok: false, error: e.storeFailed };
  }
}

const ApplyDoc = z.object({ listId: z.string().min(1), map: DocMapSchema });

/** Confirms the mapping and starts the check (jobs(): in-process, or the worker's doc-check queue). */
export async function applyDocFile(user: Writer, locale: Locale, payload: unknown): Promise<{ ok: true } | Fail> {
  const { ta } = i18nFor(locale);
  const parsed = ApplyDoc.safeParse(payload);
  if (!allowed(user) || !parsed.success) return { ok: false, error: ta.importX.docs.startFailed };
  const ok = await applyDocMap(user, parsed.data.listId, parsed.data.map).catch(() => false);
  return ok ? { ok: true } : { ok: false, error: ta.importX.docs.startFailed };
}

/** Restarts a failed or stalled check. */
export async function restartDocFile(user: Writer, locale: Locale, listId: unknown): Promise<{ ok: true } | Fail> {
  const { ta } = i18nFor(locale);
  const id = z.string().min(1).safeParse(listId);
  if (!allowed(user) || !id.success) return { ok: false, error: ta.importX.docs.restartFailed };
  const ok = await restartDocCheck(user, id.data).catch(() => false);
  return ok ? { ok: true } : { ok: false, error: ta.importX.docs.restartFailed };
}

export async function removeDocFile(user: Writer, locale: Locale, listId: unknown): Promise<{ ok: true } | Fail> {
  const { ta } = i18nFor(locale);
  const id = z.string().min(1).safeParse(listId);
  if (!allowed(user) || !id.success) return { ok: false, error: ta.importX.lists.deleteFailed };
  const ok = await deleteDocList(user, id.data).catch(() => false);
  return ok ? { ok: true } : { ok: false, error: ta.importX.lists.deleteFailed };
}
