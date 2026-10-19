import { startAudit } from '@/lib/audit-jobs';
import { applyMapping, mappingFor, MAX_UPLOAD_BYTES, storeCatalog } from '@/lib/catalog-import';
import { ownedClient, resolveClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { gate } from '@/lib/plan';
import { HEADERS, PAGE, pageLimit } from '@/lib/api/contract';
import { fingerprint, idempotent, readIdempotencyKey } from '@/lib/api/idempotency';
import { recordUsage } from '@/lib/api/limits';
import { crashed, enter, failure, type Outcome } from '@/lib/api/respond';
import { catalogOut, uploadOut } from '@/lib/api/serialize';
import { parseUpload } from '@/lib/spreadsheet';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const LIST = 'listCatalogs';
const UPLOAD = 'uploadCatalog';

/** The key's own catalogues, newest first, one page at a time (cursor = nextCursor of the previous page). */
export async function GET(request: Request) {
  const entered = await enter(LIST, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'), PAGE.catalogs);
    const cursor = url.searchParams.get('cursor');
    const clientId = url.searchParams.get('clientId');
    if (clientId && !(await ownedClient(caller.orgId, clientId))) return reply(failure(LIST, 'not_found', 'Unknown clientId.'));
    const where = { orgId: caller.orgId, ...(clientId ? { clientId } : {}) };
    if (cursor && !(await db.catalog.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
      return reply(failure(LIST, 'invalid_request', 'Unknown cursor: pass nextCursor from the previous page.'));
    }
    const rows = await db.catalog.findMany({
      where, take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, filename: true, clientId: true, createdAt: true, status: true, rowCount: true, progressDone: true },
    });
    const page = rows.slice(0, limit);
    await recordUsage(caller.keyId, caller.orgId, 0);
    return reply({ status: 200, body: { catalogs: page.map(catalogOut), nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null } });
  } catch (error) {
    return crashed(LIST, error, reply);
  }
}

/** Accepts a spreadsheet (multipart field "file", optional "clientId"), stores it and audits it in the background. */
export async function POST(request: Request) {
  const entered = await enter(UPLOAD, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const idem = readIdempotencyKey(request.headers);
    if (!idem.ok) return reply(failure(UPLOAD, 'invalid_request', 'Idempotency-Key must be 1 to 255 visible ASCII characters.'));
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File) || file.size === 0) return reply(failure(UPLOAD, 'invalid_request', 'Send the spreadsheet as multipart field "file".'));
    if (file.size > MAX_UPLOAD_BYTES) return reply(failure(UPLOAD, 'too_large', `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`));
    const requested = form.get('clientId');
    const clientId = typeof requested === 'string' && requested ? requested : null;
    const bytes = Buffer.from(await file.arrayBuffer());

    const run = async (): Promise<Outcome> => {
      const parsed = await parseUpload(bytes, file.name).catch(() => null);
      if (!parsed || parsed.rows.length === 0) return failure(UPLOAD, 'unreadable_file', 'The file could not be read or has no rows.');
      const allowed = await gate(caller.orgId, 'rowsPerMonth', parsed.rows.length);
      if (!allowed.ok) {
        return allowed.reason === 'expired'
          ? failure(UPLOAD, 'plan_expired', 'The trial has ended; activate a plan.')
          : failure(UPLOAD, 'plan_limit', 'The monthly row allowance of the plan would be exceeded.');
      }
      const client = clientId ? await ownedClient(caller.orgId, clientId) : await resolveClient(caller.orgId, null);
      if (!client) return failure(UPLOAD, 'not_found', 'Unknown clientId.');

      const mapping = await mappingFor(caller.orgId, parsed.headers);
      const { catalogId } = await storeCatalog({ orgId: caller.orgId, userId: null, clientId: client.id, filename: file.name, parsed, mapping });
      const applied = await applyMapping(caller.orgId, catalogId, mapping);
      if ('error' in applied) return failure(UPLOAD, 'unreadable_file', 'No product name column was found in the file.');

      await startAudit(catalogId, null, { mapping, via: 'api' });
      await recordUsage(caller.keyId, caller.orgId, 0);
      return { status: 202, body: uploadOut({ id: catalogId, rows: applied.rows, clientId: client.id }) };
    };
    if (!idem.key) return reply(await run());

    const done = await idempotent(caller.keyId, idem.key, fingerprint(bytes, file.name, clientId ?? ''), run);
    if (done.kind === 'in_progress') return reply(failure(UPLOAD, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Retry after it finishes.'));
    if (done.kind === 'reused') return reply(failure(UPLOAD, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.'));
    return reply(done.outcome, done.kind === 'replayed' ? { [HEADERS.replayed]: 'true' } : {});
  } catch (error) {
    return crashed(UPLOAD, error, reply);
  }
}
