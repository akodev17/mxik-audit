// transferExport: the batch's approved records straight into the client's 1C over its OData
// standard interface, one POST per document (a bank payment, a product; an invoice is one document
// with its lines), each with its own outcome. IMPLEMENTED BUT NOT VERIFIED against a real 1C
// (connection.ts says why); tested against a local fake OData server only.
import { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { refreshCounts } from './batch-state.js';
import { bankDocument, credentialsOf, hostAllowed, invoiceDocument, postDocument, productDocument, type PostResult } from './connection.js';
import { outcomeOf, planFor, recordOutcomes, type PrepareInput } from './export.js';

type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
export type Transferred = { ok: true; exportId: string; outcome: ImportOutcome } | { ok: false; error: string };

/** Requests to one 1C at a time: a few, so a 1 000-row statement does not queue for minutes nor flood the server. */
const CONCURRENCY = 4;

async function inPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Sends the batch through the org's direct 1C connection (odata), when one is configured. */
export async function transferExport(input: PrepareInput & { actorId: string }, fetcher: typeof fetch = fetch): Promise<Transferred> {
  if (input.format !== 'odata') return { ok: false, error: input.format === 'http' ? 'http_transfer_unsupported' : 'format_not_transfer' };
  const c = await credentialsOf(input.orgId);
  if (!c || c.kind !== 'odata') return { ok: false, error: 'no_connection' };
  if (!(await hostAllowed(c.baseUrl))) return { ok: false, error: 'host_refused' };
  const planned = await planFor(input);
  if (!planned.ok) return planned;
  const { loaded: { batch }, plan } = planned;
  if (plan.included.length === 0) return { ok: false, error: 'nothing_to_export' };

  const row = await db.oneCExport.create({
    data: { batchId: batch.id, format: 'odata', filename: null, recordCount: plan.included.length, recordSetHash: plan.recordSetHash, createdBy: input.actorId },
    select: { id: true },
  });

  // One document per record; an invoice is one document for all its lines.
  type Job = { ids: string[]; entitySet: string; body: Record<string, unknown> };
  let jobs: Job[];
  if (batch.kind === 'didox_invoice') {
    const meta = accounting.IncomingInvoiceMeta.safeParse(batch.meta);
    if (!meta.success) return { ok: false, error: 'meta_invalid' };
    const lines = plan.included.flatMap((i) => (i.kind === 'didox_invoice' ? [i.payload] : []));
    jobs = [{ ids: plan.included.map((i) => i.record.id), ...invoiceDocument(c.objectMap, meta.data, lines) }];
  } else {
    jobs = plan.included.map((i) => ({
      ids: [i.record.id],
      ...(i.kind === 'bank_statement' ? bankDocument(c.objectMap, i.payload) : i.kind === 'product_catalog' ? productDocument(c.objectMap, i.payload) : { entitySet: '', body: {} }),
    }));
  }
  const results: PostResult[] = await inPool(jobs, CONCURRENCY, (job) => postDocument(c, job.entitySet, job.body, fetcher));

  const imported: { id: string; onecRef: string | null }[] = [];
  const rejected: { id: string; reason: string; message: string | null }[] = [];
  jobs.forEach((job, i) => {
    const r = results[i];
    for (const id of job.ids) {
      if (r?.ok) imported.push({ id, onecRef: r.ref });
      else rejected.push({ id, reason: r?.reason ?? 'onec_refused', message: r?.ok === false ? r.message : null });
    }
  });
  const rejectedReasons: Record<string, number> = {};
  for (const r of rejected) rejectedReasons[r.reason] = (rejectedReasons[r.reason] ?? 0) + 1;
  const outcome = outcomeOf('odata', plan, imported.length, rejected.length, rejectedReasons);

  await db.$transaction(async (tx) => {
    await tx.oneCExport.update({ where: { id: row.id }, data: { outcome, recordCount: imported.length } });
    await recordOutcomes(tx, row.id, plan, imported, rejected);
    await tx.importBatch.update({
      where: { id: batch.id },
      data: rejected.length === 0 ? { status: 'exported', error: null } : { error: `onec_rejected:${rejected.length}` },
    });
    await refreshCounts(batch.id, tx);
    await tx.auditEvent.create({
      data: {
        orgId: input.orgId, actorId: input.actorId, action: 'onec.transferred', targetId: batch.id,
        payload: { batchId: batch.id, clientId: batch.clientId, kind: batch.kind, format: 'odata', exportId: row.id, imported: imported.length, rejected: rejected.length, skipped: outcome.skipped },
      },
    });
  }, { timeout: 60_000 });
  const firstError = rejected[0];
  await db.oneCConnection.update({ where: { orgId: input.orgId }, data: { lastError: firstError ? `${firstError.reason}${firstError.message ? `: ${firstError.message.slice(0, 200)}` : ''}` : null } });
  return { ok: true, exportId: row.id, outcome };
}
