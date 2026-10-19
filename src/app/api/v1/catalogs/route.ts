import { NextResponse } from 'next/server';
import { startAudit } from '@/lib/audit-jobs';
import { applyMapping, mappingFor, MAX_UPLOAD_BYTES, storeCatalog } from '@/lib/catalog-import';
import { ownedClient, resolveClient } from '@/lib/clients';
import { gate } from '@/lib/plan';
import { apiError, enter } from '@/lib/api/respond';
import { recordUsage } from '@/lib/api/limits';
import { parseUpload } from '@/lib/spreadsheet';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Accepts a spreadsheet (multipart field "file", optional "clientId"), stores it and audits it in the background. */
export async function POST(request: Request) {
  const entered = await enter(request);
  if ('response' in entered) return entered.response;
  const { caller } = entered;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File) || file.size === 0) return apiError('invalid_request', 'Send the spreadsheet as multipart field "file".');
  if (file.size > MAX_UPLOAD_BYTES) return apiError('too_large', `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);

  const parsed = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name).catch(() => null);
  if (!parsed || parsed.rows.length === 0) return apiError('unreadable_file', 'The file could not be read or has no rows.');

  const allowed = await gate(caller.orgId, 'rowsPerMonth', parsed.rows.length);
  if (!allowed.ok) return apiError(allowed.reason === 'expired' ? 'plan_expired' : 'plan_limit', allowed.reason === 'expired' ? 'The trial has ended; activate a plan.' : 'The monthly row allowance of the plan would be exceeded.');

  const requested = form.get('clientId');
  const client = typeof requested === 'string' && requested ? await ownedClient(caller.orgId, requested) : await resolveClient(caller.orgId, null);
  if (!client) return apiError('not_found', 'Unknown clientId.');

  const mapping = await mappingFor(caller.orgId, parsed.headers);
  const { catalogId } = await storeCatalog({ orgId: caller.orgId, userId: null, clientId: client.id, filename: file.name, parsed, mapping });
  const applied = await applyMapping(caller.orgId, catalogId, mapping);
  if ('error' in applied) return apiError('unreadable_file', 'No product name column was found in the file.');

  await startAudit(catalogId, null, { mapping, via: 'api' });
  await recordUsage(caller.keyId, caller.orgId, 0);
  return NextResponse.json({ id: catalogId, status: 'analyzing', rows: applied.rows, clientId: client.id }, { status: 202 });
}
