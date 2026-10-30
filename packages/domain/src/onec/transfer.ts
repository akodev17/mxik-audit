// transferExport: the batch's approved records straight into the client's 1C over its OData
// standard interface (odata.ts): the object map resolved against the base's $metadata first (a gap
// in the composition refuses the transfer with each missing object named), the references found
// in the base, one POST per document (a bank payment, a product; an invoice is one document with
// its lines), created unposted and posted only when the map says so, each with its own outcome. A
// corrected ЭСФ updates the receipt made for the one it corrects. IMPLEMENTED BUT NOT VERIFIED
// against a real 1C (connection.ts says why); tested against a fake server built from real saved
// responses (fixtures/odata/SOURCES.md).
import { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { refreshCounts } from './batch-state.js';
import {
  bankDocument, credentialsOf, hostFetcher, invoiceDocument, productDocument, resolveMap, writeRef,
  type CompositionProblem, type DocumentJob, type ObjectTarget, type RefNeed, type TargetKey,
} from './connection.js';
import { outcomeOf, planFor, recordOutcomes, type PrepareInput } from './export.js';
import { castRef, datetime, discover, forgetMetadata, guid, ODataClient, str, type Metadata } from './odata.js';

type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
export type Transferred =
  | { ok: true; exportId: string; outcome: ImportOutcome }
  | { ok: false; error: string; message?: string; problems?: CompositionProblem[] };

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

/** Refusals that mean the base's composition changed since its $metadata was read. */
const STALE = new Set(['onec_property_not_found', 'onec_type_not_found', 'forbidden_or_not_published']);

type Found = { key: string | null; ambiguous: boolean };

/**
 * Finds references in the base: `key eq 'value'` (and the owner's key for a contract), folders and
 * deleted items left out when the catalogue has them, two rows asked to tell "one" from "several".
 * Each distinct lookup runs once per transfer.
 */
class RefFinder {
  private readonly cache = new Map<string, Promise<Found>>();
  constructor(private readonly client: ODataClient, private readonly md: Metadata) {}

  find(entitySet: string, key: string, value: string, ownerKey: string | null): Promise<Found> {
    const id = `${entitySet}|${key}|${value}|${ownerKey ?? ''}`;
    let hit = this.cache.get(id);
    if (!hit) {
      hit = this.lookup(entitySet, key, value, ownerKey);
      this.cache.set(id, hit);
    }
    return hit;
  }

  private async lookup(entitySet: string, key: string, value: string, ownerKey: string | null): Promise<Found> {
    const shape = this.md.sets.get(entitySet);
    const has = (p: string): boolean => Boolean(shape?.typed && shape.properties.has(p));
    const filter = [
      `${key} eq ${str(value)}`,
      ownerKey ? `Owner_Key eq ${guid(ownerKey)}` : null,
      has('IsFolder') ? 'IsFolder eq false' : null,
      has('DeletionMark') ? 'DeletionMark eq false' : null,
    ].filter(Boolean).join(' and ');
    const page = await this.client.page(entitySet, { filter, select: ['Ref_Key'], top: 2 });
    if (!page.ok) return { key: null, ambiguous: false };
    const keys = page.rows.map((r) => r['Ref_Key']).filter((k): k is string => typeof k === 'string');
    return keys.length === 1 ? { key: keys[0] ?? null, ambiguous: false } : { key: null, ambiguous: keys.length > 1 };
  }
}

type JobOutcome = { ok: true; ref: string | null; message: string | null } | { ok: false; reason: string; message: string | null };

/**
 * Fills the job's references. Owners first (a contract is looked up under its counterparty). A
 * goods line whose product is not in the base refuses the document (1C would refuse it, or create a
 * product with «Не создавать номенклатуру» off): the lines are named instead (onec §8.11).
 */
async function fillRefs(finder: RefFinder, md: Metadata, target: ObjectTarget, job: DocumentJob): Promise<{ ok: true; notes: string[]; found: Map<string, string> } | { ok: false; reason: string; message: string }> {
  const notes: string[] = [];
  const found = new Map<string, string>();
  const ordered = [...job.needs].sort((a, b) => Number(Boolean(a.ref.owner)) - Number(Boolean(b.ref.owner)));
  const missingProducts: number[] = [];
  for (const n of ordered) {
    if (!md.sets.has(n.ref.entitySet)) continue; // not published: listed by the connection test, left empty
    const ownerKey = n.ref.owner ? found.get(`${n.ref.owner}|${n.line ?? ''}`) ?? found.get(`${n.ref.owner}|`) ?? null : null;
    if (n.ref.owner && !ownerKey) { notes.push(`${n.name}_no_owner`); continue; }
    const hit = await finder.find(n.ref.entitySet, n.ref.key, n.value, ownerKey);
    if (!hit.key) {
      if (n.name === 'product' && n.line !== null) missingProducts.push(n.line + 1);
      else notes.push(`${n.name}_${hit.ambiguous ? 'ambiguous' : 'not_found'}`);
      continue;
    }
    found.set(`${n.name}|${n.line ?? ''}`, hit.key);
    if (!writeRef(md, job, target.linesPart, n, hit.key)) notes.push(`${n.name}_attribute_missing`);
  }
  if (missingProducts.length > 0) return { ok: false, reason: 'nomenclature_missing', message: `lines ${missingProducts.slice(0, 20).join(', ')}` };
  return { ok: true, notes, found };
}

/**
 * A document the base already has with the same incoming number and date (and counterparty): the
 * receipt a corrected ЭСФ replaces, or a payment a timed-out transfer did write after all. A
 * composite counterparty is compared with cast(guid'…','Catalog_X') (§8.32).
 */
async function existing(client: ODataClient, md: Metadata, target: ObjectTarget, number: string, date: string, counterpartyKey: string | null): Promise<{ key: string | null; ambiguous: boolean }> {
  const numberAttr = target.fields['number'];
  const dateAttr = target.fields['docDate'];
  if (!numberAttr || !dateAttr) return { key: null, ambiguous: false };
  const conditions = [`${numberAttr} eq ${str(number)}`, `${dateAttr} eq ${datetime(date)}`, 'DeletionMark eq false'];
  const cp = target.refs?.['counterparty'];
  const shape = md.sets.get(target.entitySet);
  if (cp && counterpartyKey) {
    if (shape?.typed && shape.properties.has(cp.attribute) && shape.properties.has(`${cp.attribute}_Type`)) conditions.push(`${cp.attribute} eq ${castRef(counterpartyKey, cp.entitySet)}`);
    else conditions.push(`${cp.attribute}_Key eq ${guid(counterpartyKey)}`);
  }
  const page = await client.page(target.entitySet, { filter: conditions.join(' and '), select: ['Ref_Key'], top: 2 });
  if (!page.ok) return { key: null, ambiguous: false };
  const keys = page.rows.map((r) => r['Ref_Key']).filter((k): k is string => typeof k === 'string');
  return keys.length === 1 ? { key: keys[0] ?? null, ambiguous: false } : { key: null, ambiguous: keys.length > 1 };
}

/**
 * FacturaType values that correct the invoice they name (4, 5, 8): the receipt is replaced. The additional
 * types (1, 6, 9) add to the original and the others name none, so each of those is a receipt of its own
 * (didox research §2.1 "SubTypes").
 */
const CORRECTING_TYPES: ReadonlySet<number> = new Set([4, 5, 8]);

/**
 * The 1C reference of the receipt Tasnivo itself wrote for the invoice a corrected one replaces: the same
 * client's invoice of the same seller, by its roaming id or by number and date (numbers repeat across sellers).
 */
async function originalReceipt(
  orgId: string, batch: { id: string; clientId: string | null }, sellerInn: string | null, old: NonNullable<IncomingInvoiceMeta['oldFactura']>,
): Promise<string | null> {
  const byNumber = sellerInn
    ? [{ AND: [{ meta: { path: ['number'], equals: old.number } }, { meta: { path: ['date'], equals: old.date } }, { meta: { path: ['seller', 'inn'], equals: sellerInn } }] }]
    : [];
  const byId = old.id ? [{ externalRef: old.id }, { meta: { path: ['didox', 'facturaId'], equals: old.id } }] : [];
  if (byNumber.length + byId.length === 0) return null;
  const batches = await db.importBatch.findMany({
    where: { orgId, clientId: batch.clientId, kind: 'didox_invoice', id: { not: batch.id }, OR: [...byId, ...byNumber] },
    orderBy: { createdAt: 'desc' }, take: 5, select: { id: true },
  });
  for (const b of batches) {
    const rows = await db.importRecord.findMany({ where: { batchId: b.id, status: 'exported' }, select: { outcome: true }, take: 200 });
    const ref = rows.map((r) => (r.outcome as { onecRef?: string | null } | null)?.onecRef).find((k): k is string => typeof k === 'string' && k.length > 0);
    if (ref) return ref;
  }
  return null;
}

/** Sends the batch through the org's direct 1C connection (odata), when one is configured. */
export async function transferExport(input: PrepareInput & { actorId: string }, fetcher?: typeof fetch): Promise<Transferred> {
  if (input.format !== 'odata') return { ok: false, error: input.format === 'http' ? 'http_transfer_unsupported' : 'format_not_transfer' };
  const c = await credentialsOf(input.orgId);
  if (!c || c.kind !== 'odata') return { ok: false, error: 'no_connection' };
  // Pinned to the checked address (host-guard.ts): the name is not resolved again for the calls.
  const pinned = await hostFetcher(c.baseUrl);
  if (!pinned) return { ok: false, error: 'host_refused' };
  const planned = await planFor(input);
  if (!planned.ok) return planned;
  const { loaded: { batch, records }, plan } = planned;
  if (plan.included.length === 0) return { ok: false, error: 'nothing_to_export' };

  // What the base publishes, read once per 10 minutes and resolved per $metadata hash (§8.34).
  const client = new ODataClient(c, fetcher ?? pinned);
  const discovered = await discover(client);
  if (!discovered.ok) return { ok: false, error: discovered.status === 401 || discovered.status === 403 ? 'auth_failed' : 'metadata_unavailable', message: discovered.message ?? discovered.reason };
  const md = discovered.md;
  const resolution = resolveMap(c.objectMap, md);
  const used: TargetKey[] = batch.kind === 'didox_invoice' ? ['invoice'] : batch.kind === 'product_catalog' ? ['product']
    : [...new Set(plan.included.map((i) => (i.kind === 'bank_statement' && i.payload.direction === 'credit' ? 'bankCredit' as const : 'bankDebit' as const)))];
  const blocking = resolution.problems.filter((p) => p.required && used.includes(p.target as TargetKey));
  if (blocking.length > 0) return { ok: false, error: 'composition_incomplete', problems: blocking };
  const map = resolution.map;

  const row = await db.oneCExport.create({
    data: { batchId: batch.id, format: 'odata', filename: null, recordCount: plan.included.length, recordSetHash: plan.recordSetHash, createdBy: input.actorId },
    select: { id: true },
  });

  // One document per record; an invoice is one document for all its lines.
  type Job = DocumentJob & {
    ids: string[]; target: ObjectTarget; retry: boolean; correction: IncomingInvoiceMeta['oldFactura'] | null; date: string; number: string | null;
    /** Every line of the document goes (a correction replaces the receipt's whole tabular part, so it must). */
    whole: boolean; sellerInn: string | null;
  };
  let jobs: Job[];
  if (batch.kind === 'didox_invoice') {
    const meta = accounting.IncomingInvoiceMeta.safeParse(batch.meta);
    if (!meta.success) return { ok: false, error: 'meta_invalid' };
    const lines = plan.included.flatMap((i) => (i.kind === 'didox_invoice' ? [i.payload] : []));
    const whole = plan.included.length === records.length;
    const correction = meta.data.facturaType && CORRECTING_TYPES.has(meta.data.facturaType) && meta.data.oldFactura ? meta.data.oldFactura : null;
    jobs = [{
      ids: plan.included.map((i) => i.record.id), ...invoiceDocument(map, meta.data, lines, whole), target: map.invoice, retry: false, correction,
      date: meta.data.date, number: meta.data.number, whole, sellerInn: meta.data.seller.inn,
    }];
  } else {
    jobs = plan.included.map((i) => {
      const retry = i.record.outcome?.result === 'rejected' && /^(timeout|unreachable)/.test(i.record.outcome.reason ?? '');
      if (i.kind === 'bank_statement') {
        return { ids: [i.record.id], ...bankDocument(map, i.payload), target: i.payload.direction === 'credit' ? map.bankCredit : map.bankDebit, retry, correction: null, date: i.payload.date, number: i.payload.docNumber, whole: true, sellerInn: null };
      }
      const p = i.kind === 'product_catalog' ? productDocument(map, i.payload) : { entitySet: '', body: {}, needs: [] as RefNeed[], notes: [] };
      return { ids: [i.record.id], ...p, target: map.product, retry: false, correction: null, date: '', number: null, whole: true, sellerInn: null };
    });
  }

  const finder = new RefFinder(client, md);
  const run = async (job: Job): Promise<JobOutcome> => {
    const refs = await fillRefs(finder, md, job.target, job);
    if (!refs.ok) return { ok: false, reason: refs.reason, message: refs.message };
    const notes = [...job.notes, ...refs.notes];
    const counterparty = refs.found.get('counterparty|') ?? null;
    let ref: string | null = null;
    // A corrected ЭСФ replaces the receipt of the one it corrects (onec §8.35). The PATCH resends the whole
    // tabular part, so a correction goes with all its lines or not at all (a part would drop the others).
    if (job.correction && !job.whole) return { ok: false, reason: 'correction_partial', message: `${job.correction.number} ${job.correction.date}` };
    if (job.correction) {
      ref = await originalReceipt(input.orgId, batch, job.sellerInn, job.correction);
      // In the base, only a receipt of this seller: a counterparty 1C does not know has no receipt there to replace.
      if (!ref && counterparty) {
        const there = await existing(client, md, job.target, job.correction.number, job.correction.date, counterparty);
        if (there.ambiguous) return { ok: false, reason: 'correction_ambiguous', message: `${job.correction.number} ${job.correction.date}` };
        ref = there.key;
      }
      if (ref) {
        const updated = await client.update(job.entitySet, ref, job.body);
        if (!updated.ok) return { ok: false, reason: updated.reason, message: updated.message };
        notes.push('correction_updated');
      } else notes.push('correction_original_not_found');
    } else if (job.retry && job.number) {
      // The last attempt timed out: 1C may have written it anyway. Look before writing a second one.
      const there = await existing(client, md, job.target, job.number, job.date, counterparty);
      if (there.key) { ref = there.key; notes.push('found_after_timeout'); }
    }
    if (!ref) {
      const created = await client.create(md, job.entitySet, job.body);
      if (!created.ok) {
        if (STALE.has(created.reason)) forgetMetadata(client);
        return { ok: false, reason: created.reason, message: created.message };
      }
      ref = created.ref;
    }
    // Created unposted; posting is a separate call whose refusal (500) is 1C's business rule (§8.28).
    if (job.target.post && ref) {
      const posted = await client.post(job.entitySet, ref);
      if (!posted.ok) notes.push(`${posted.reason}: ${posted.message ?? ''}`.trim());
    }
    return { ok: true, ref, message: notes.length > 0 ? notes.join('; ').slice(0, 1000) : null };
  };
  const results = await inPool(jobs, CONCURRENCY, run);

  const imported: { id: string; onecRef: string | null; message: string | null }[] = [];
  const rejected: { id: string; reason: string; message: string | null }[] = [];
  jobs.forEach((job, i) => {
    const r = results[i];
    for (const id of job.ids) {
      if (r?.ok) imported.push({ id, onecRef: r.ref, message: r.message });
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
