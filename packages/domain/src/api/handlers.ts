// The /api/v1 operations once the key is authenticated and within its rate limit: what the web
// app's route handlers and the Nest public-api controller both run. Framework-free: they take the
// caller and the parts of the request they read, and answer an Outcome plus any extra headers
// (Idempotent-Replayed). The caller adds the key's rate-limit headers and turns a throw into the
// documented 500.
import { z } from 'zod';
import { db } from '@tasnivo/db';
import { startAudit } from '../audit-jobs';
import { applyMapping, mappingFor, MAX_UPLOAD_BYTES, storeCatalog } from '../catalog-import';
import { ownedClient, resolveClient } from '../clients';
import { findingTypeCounts } from '../finding-type-counts';
import { gate } from '../plan';
import { parseUpload } from '../spreadsheet';
import { checkProducts, CheckItemSchema } from './check';
import { HEADERS, PAGE, pageLimit, type OperationId } from './contract';
import { fingerprint, idempotent, parseIdempotencyKey, type Idempotent } from './idempotency';
import type { ApiCaller } from './keys';
import { apiConfig, checkAllowance, recordUsage } from './limits';
import { failure, type Outcome } from './respond';
import { catalogOut, findingOut, reportOut, uploadOut } from './serialize';

export type Reply = { outcome: Outcome; headers: Record<string, string> };

const plain = (outcome: Outcome): Reply => ({ outcome, headers: {} });

const BAD_KEY = 'Idempotency-Key must be 1 to 255 visible ASCII characters.';
const BAD_CURSOR = 'Unknown cursor: pass nextCursor from the previous page.';

/** An idempotent operation's answer: the first success, a replay of it, or why the key cannot be used. */
function idempotentReply(op: Extract<OperationId, 'check' | 'uploadCatalog'>, done: Idempotent): Reply {
  if (done.kind === 'in_progress') return plain(failure(op, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Retry after it finishes.'));
  if (done.kind === 'reused') return plain(failure(op, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.'));
  return { outcome: done.outcome, headers: done.kind === 'replayed' ? { [HEADERS.replayed]: 'true' } : {} };
}

const CheckBody = z.union([CheckItemSchema, z.object({ items: z.array(CheckItemSchema).min(1) })]);

/**
 * POST /api/v1/check. `body` is the parsed JSON, or null when the request had none or it did not
 * parse; `idempotencyKey` the raw header (null when absent).
 */
export async function checkOperation(caller: ApiCaller, input: { idempotencyKey: string | null; body: unknown }): Promise<Reply> {
  const op = 'check';
  const idem = parseIdempotencyKey(input.idempotencyKey);
  if (!idem.ok) return plain(failure(op, 'invalid_request', BAD_KEY));
  const body = CheckBody.safeParse(input.body);
  if (!body.success) return plain(failure(op, 'invalid_request', 'Send {"name": "..."} or {"items": [{"name": "..."}]}; name is required.'));
  const items = 'items' in body.data ? body.data.items : [body.data];
  const max = apiConfig().maxCheckItems;
  if (items.length > max) return plain(failure(op, 'invalid_request', `At most ${max} items per request.`));

  const run = async (): Promise<Outcome> => {
    const allowance = await checkAllowance(caller.orgId, items.length);
    if (!allowance.ok) {
      return allowance.reason === 'expired'
        ? failure(op, 'plan_expired', 'The trial has ended; activate a plan.')
        : failure(op, 'plan_limit', 'The monthly check allowance of the plan is used up.');
    }
    const results = await checkProducts(caller.orgId, items);
    await recordUsage(caller.keyId, caller.orgId, items.length);
    return { status: 200, body: { results } };
  };
  if (!idem.key) return plain(await run());
  return idempotentReply(op, await idempotent(caller.keyId, idem.key, fingerprint(JSON.stringify(items)), run));
}

/** GET /api/v1/catalogs: the key's own catalogues, newest first, one page at a time. */
export async function listCatalogsOperation(caller: ApiCaller, query: { limit: string | null; cursor: string | null; clientId: string | null }): Promise<Reply> {
  const op = 'listCatalogs';
  const limit = pageLimit(query.limit, PAGE.catalogs);
  const { cursor, clientId } = query;
  if (clientId && !(await ownedClient(caller.orgId, clientId))) return plain(failure(op, 'not_found', 'Unknown clientId.'));
  // Unconfirmed uploads (drafts) are not catalogues yet: the web list keeps them apart and they expire (B12).
  const where = { orgId: caller.orgId, status: { not: 'uploaded' as const }, ...(clientId ? { clientId } : {}) };
  if (cursor && !(await db.catalog.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
    return plain(failure(op, 'invalid_request', BAD_CURSOR));
  }
  const rows = await db.catalog.findMany({
    where, take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, filename: true, clientId: true, createdAt: true, status: true, rowCount: true, progressDone: true },
  });
  const page = rows.slice(0, limit);
  await recordUsage(caller.keyId, caller.orgId, 0);
  return plain({ status: 200, body: { catalogs: page.map(catalogOut), nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null } });
}

/** The multipart upload as the handler sees it: the "file" part (null when missing or not a file) and "clientId". */
export type UploadInput = {
  idempotencyKey: string | null;
  /** False when the body was not multipart form data at all. */
  form: boolean;
  file: { name: string; size: number; bytes: () => Promise<Buffer> } | null;
  clientId: string | null;
};

/** POST /api/v1/catalogs: stores the spreadsheet and audits it in the background (202). */
export async function uploadCatalogOperation(caller: ApiCaller, input: UploadInput): Promise<Reply> {
  const op = 'uploadCatalog';
  const idem = parseIdempotencyKey(input.idempotencyKey);
  if (!idem.ok) return plain(failure(op, 'invalid_request', BAD_KEY));
  const file = input.file;
  if (!input.form || !file || file.size === 0) return plain(failure(op, 'invalid_request', 'Send the spreadsheet as multipart field "file".'));
  if (file.size > MAX_UPLOAD_BYTES) return plain(failure(op, 'too_large', `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`));
  const clientId = input.clientId || null;
  const bytes = await file.bytes();

  const run = async (): Promise<Outcome> => {
    const chosen = clientId ? await ownedClient(caller.orgId, clientId) : null;
    if (clientId && !chosen) return failure(op, 'not_found', 'Unknown clientId.');
    // Same rule as the web upload: an archived client takes no new catalogues.
    if (chosen && await db.client.count({ where: { id: chosen.id, archivedAt: { not: null } } })) {
      return failure(op, 'not_found', 'The client is archived; restore it in the app before uploading.');
    }
    const parsed = await parseUpload(bytes, file.name).catch(() => null);
    if (!parsed || parsed.rows.length === 0) return failure(op, 'unreadable_file', 'The file could not be read or has no rows.');
    const allowed = await gate(caller.orgId, 'rowsPerMonth', parsed.rows.length);
    if (!allowed.ok) {
      return allowed.reason === 'expired'
        ? failure(op, 'plan_expired', 'The trial has ended; activate a plan.')
        : failure(op, 'plan_limit', 'The monthly row allowance of the plan would be exceeded.');
    }
    const client = chosen ?? await resolveClient(caller.orgId, null);

    const mapping = await mappingFor(caller.orgId, parsed.headers);
    const { catalogId } = await storeCatalog({ orgId: caller.orgId, userId: null, clientId: client.id, filename: file.name, parsed, mapping });
    const applied = await applyMapping(caller.orgId, catalogId, mapping);
    if ('error' in applied) return failure(op, 'unreadable_file', 'No product name column was found in the file.');

    await startAudit(catalogId, null, { mapping, via: 'api' });
    await recordUsage(caller.keyId, caller.orgId, 0);
    return { status: 202, body: uploadOut({ id: catalogId, rows: applied.rows, clientId: client.id }) };
  };
  if (!idem.key) return plain(await run());
  return idempotentReply(op, await idempotent(caller.keyId, idem.key, fingerprint(bytes, file.name, clientId ?? ''), run));
}

/** GET /api/v1/catalogs/{id}/report: status, summary and one page of findings. */
export async function reportOperation(caller: ApiCaller, id: string, query: { limit: string | null; cursor: string | null }): Promise<Reply> {
  const op = 'report';
  const catalog = await db.catalog.findFirst({
    where: { id, orgId: caller.orgId },
    select: { id: true, filename: true, clientId: true, createdAt: true, status: true, rowCount: true, progressDone: true },
  });
  if (!catalog) return plain(failure(op, 'not_found', 'Catalogue not found.'));
  await recordUsage(caller.keyId, caller.orgId, 0);
  if (catalog.status !== 'ready') return plain({ status: 200, body: reportOut({ catalog, summary: null, findings: [], nextCursor: null }) });

  const limit = pageLimit(query.limit, PAGE.findings);
  const { cursor } = query;
  const where = { item: { catalogId: catalog.id } };
  if (cursor && !(await db.finding.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
    return plain(failure(op, 'invalid_request', BAD_CURSOR));
  }
  const [byType, rows] = await Promise.all([
    findingTypeCounts(catalog.id),
    db.finding.findMany({
      where, take: limit + 1, orderBy: [{ item: { rowIndex: 'asc' } }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { item: { select: { rowIndex: true, rawName: true, barcode: true, unit: true, existingMxik: true } } },
    }),
  ]);
  const page = rows.slice(0, limit);
  return plain({
    status: 200,
    body: reportOut({
      catalog,
      summary: Object.fromEntries(byType.map((g) => [g.type, g.count])),
      findings: page.map(findingOut),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
    }),
  });
}
