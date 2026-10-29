// A reviewer who rejects a dictionary suggestion, or reports it wrong, disputes the entry it came
// from: it is still suggested, but auto-accept and the "confirmed" view leave it out until an admin
// confirms or edits it. Every dispute is logged; a decision's dispute is taken back by its undo.
import type { Prisma } from '@prisma/client';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { readEvidence } from '@tasnivo/core/match/evidence';
import { db } from '@tasnivo/db';

type Tx = Pick<Prisma.TransactionClient, 'firmMapping' | 'auditEvent'>;

export type SuggestionRow = {
  id: string;
  evidence: unknown;
  suggestedMxik: string | null;
  item: { rawName: string; unit: string | null; barcode: string | null };
};

/**
 * The entry each dictionary suggestion came from (finding id → entry id): the id the audit stored,
 * else the row's barcode or name key, and only while the entry still holds the suggested code.
 */
export async function dictionaryEntriesOf(orgId: string, findings: readonly SuggestionRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = findings.flatMap((f) => {
    const evidence = readEvidence(f.evidence);
    if (evidence?.stage !== 'dictionary' || !f.suggestedMxik) return [];
    return [{ f, code: f.suggestedMxik, entryId: evidence.dictionaryEntryId ?? null, keys: dictionaryKeys(f.item) }];
  });
  if (rows.length === 0) return out;
  const ids = rows.flatMap((r) => (r.entryId ? [r.entryId] : []));
  const barcodes = rows.flatMap((r) => (r.keys.barcode ? [r.keys.barcode] : []));
  const names = rows.flatMap((r) => (r.keys.name ? [r.keys.name] : []));
  const entries = await db.firmMapping.findMany({
    where: { orgId, OR: [{ id: { in: ids } }, { kind: 'barcode', key: { in: barcodes } }, { kind: 'name', key: { in: names } }] },
    select: { id: true, kind: true, key: true, code: true },
  });
  const byId = new Map(entries.map((e) => [e.id, e]));
  const byKey = new Map(entries.map((e) => [`${e.kind}:${e.key}`, e]));
  for (const r of rows) {
    const candidates = [
      r.entryId ? byId.get(r.entryId) : undefined,
      r.keys.barcode ? byKey.get(`barcode:${r.keys.barcode}`) : undefined,
      r.keys.name ? byKey.get(`name:${r.keys.name}`) : undefined,
    ];
    const hit = candidates.find((e) => e !== undefined && e.code === r.code);
    if (hit) out.set(r.f.id, hit.id);
  }
  return out;
}

export type DisputeVia = 'rejected' | 'wrong_suggestion';

/**
 * Marks the entries disputed (those not disputed already) at `at`, one `dictionary.disputed` event
 * each. Returns the entry ids it marked, which a decision event keeps for its undo.
 */
export async function disputeEntries(
  tx: Tx,
  o: { orgId: string; userId: string; at: Date; via: DisputeVia; catalogId: string; reason?: string; byFinding: ReadonlyMap<string, string> },
): Promise<string[]> {
  if (o.byFinding.size === 0) return [];
  const open = await tx.firmMapping.findMany({
    where: { orgId: o.orgId, id: { in: [...new Set(o.byFinding.values())] }, disputedAt: null },
    select: { id: true, code: true, label: true },
  });
  if (open.length === 0) return [];
  const ids = open.map((e) => e.id);
  await tx.firmMapping.updateMany({ where: { orgId: o.orgId, id: { in: ids }, disputedAt: null }, data: { disputedAt: o.at, disputedBy: o.userId } });
  const findingOf = new Map([...o.byFinding].map(([findingId, entryId]) => [entryId, findingId]));
  await tx.auditEvent.createMany({
    data: open.map((e) => ({
      orgId: o.orgId, actorId: o.userId, action: 'dictionary.disputed', targetId: e.id, createdAt: o.at,
      payload: { via: o.via, code: e.code, label: e.label, findingId: findingOf.get(e.id) ?? null, catalogId: o.catalogId, ...(o.reason ? { reason: o.reason } : {}) },
    })),
  });
  return ids;
}

/** Reads the disputed entry ids back from a decision event payload. */
export function readDisputed(payload: Record<string, unknown>): string[] {
  const v = payload['dictionaryDisputed'];
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
}

/** Undo of a decision: lifts the disputes it set, unless something changed the entry since. */
export async function liftDisputes(tx: Tx, orgId: string, ids: readonly string[], at: Date, by: string | null): Promise<number> {
  if (ids.length === 0 || !by) return 0;
  const lifted = await tx.firmMapping.updateMany({ where: { orgId, id: { in: [...ids] }, disputedAt: at, disputedBy: by }, data: { disputedAt: null, disputedBy: null } });
  return lifted.count;
}
