import { HEADERS } from '@tasnivo/domain/api/contract';
import { listCatalogsOperation, uploadCatalogOperation } from '@tasnivo/domain/api/handlers';
import { crashed, enter } from '@/lib/api/respond';

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
    const done = await listCatalogsOperation(caller, {
      limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'), clientId: url.searchParams.get('clientId'),
    });
    return reply(done.outcome, done.headers);
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
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const requested = form?.get('clientId');
    const done = await uploadCatalogOperation(caller, {
      idempotencyKey: request.headers.get(HEADERS.idempotencyKey),
      form: form !== null,
      file: file instanceof File ? { name: file.name, size: file.size, bytes: async () => Buffer.from(await file.arrayBuffer()) } : null,
      clientId: typeof requested === 'string' && requested ? requested : null,
    });
    return reply(done.outcome, done.headers);
  } catch (error) {
    return crashed(UPLOAD, error, reply);
  }
}
