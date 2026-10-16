// Catalogue versions: carry a client's earlier decisions over to the new upload,
// and describe what changed between the two.
import { pairVersions, unchanged, type Pairing, type VersionItem } from '../core/match/version-pairs.js';
import { db } from './db.js';

const CHUNK = 5000;
const ITEM_SELECT = { id: true, rowIndex: true, rawName: true, unit: true, barcode: true, existingMxik: true } as const;

async function chunked<T, R>(ids: readonly T[], fn: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await fn(ids.slice(i, i + CHUNK)));
  return out;
}

/** Remembers the client's earlier ready catalogue as this one's previous version. */
export async function linkPrevious(catalogId: string): Promise<void> {
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true, clientId: true, previousId: true, createdAt: true } });
  if (!catalog || catalog.previousId || !catalog.clientId) return;
  const previous = await db.catalog.findFirst({
    where: { orgId: catalog.orgId, clientId: catalog.clientId, status: 'ready', id: { not: catalogId }, createdAt: { lt: catalog.createdAt } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  if (previous) await db.catalog.update({ where: { id: catalogId }, data: { previousId: previous.id } });
}

async function loadPairing(orgId: string, catalogId: string): Promise<{ pairing: Pairing; previousId: string } | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId }, select: { previousId: true } });
  if (!catalog?.previousId) return null;
  const previous = await db.catalog.findFirst({ where: { id: catalog.previousId, orgId }, select: { id: true } });
  if (!previous) return null;
  const [prevItems, nextItems] = await Promise.all([
    db.catalogItem.findMany({ where: { catalogId: previous.id }, select: ITEM_SELECT }),
    db.catalogItem.findMany({ where: { catalogId }, select: ITEM_SELECT }),
  ]);
  return { pairing: pairVersions(prevItems, nextItems), previousId: previous.id };
}

/**
 * Applies the previous version's decisions to rows that did not change: same
 * product, unit and code, same kind of finding, and an accepted code that is
 * still live. Everything else stays pending for review. Returns rows carried.
 */
export async function carryOver(catalogId: string, actorId: string | null): Promise<number> {
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true } });
  if (!catalog) return 0;
  const loaded = await loadPairing(catalog.orgId, catalogId);
  if (!loaded) return 0;
  const same = loaded.pairing.pairs.filter((p) => unchanged(p.prev, p.next));
  if (same.length === 0) return 0;

  const prevByNext = new Map(same.map((p) => [p.next.id, p.prev.id]));
  const decided = await chunked(same.map((p) => p.prev.id), (part) => db.finding.findMany({
    where: { itemId: { in: part }, decision: { in: ['accepted', 'rejected'] } },
    select: { itemId: true, type: true, decision: true, chosenMxik: true, suggestedMxik: true },
  }));
  const decidedKey = new Map(decided.map((f) => [`${f.itemId}|${f.type}`, f]));
  const pending = await chunked([...prevByNext.keys()], (part) => db.finding.findMany({
    where: { itemId: { in: part }, decision: 'pending' },
    select: { id: true, itemId: true, type: true, suggestedMxik: true },
  }));

  const accepted = decided.flatMap((f) => (f.decision === 'accepted' && f.chosenMxik ? [f.chosenMxik] : []));
  const live = accepted.length === 0 ? new Set<string>() : new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${[...new Set(accepted)]}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));

  const ids: string[] = [];
  const decisions: string[] = [];
  const codes: (string | null)[] = [];
  for (const f of pending) {
    const before = decidedKey.get(`${prevByNext.get(f.itemId) ?? ''}|${f.type}`);
    if (!before) continue;
    if (before.decision === 'accepted' && before.chosenMxik && live.has(before.chosenMxik)) {
      ids.push(f.id); decisions.push('accepted'); codes.push(before.chosenMxik);
    } else if (before.decision === 'rejected' && before.suggestedMxik === f.suggestedMxik) {
      ids.push(f.id); decisions.push('rejected'); codes.push(null);
    }
  }
  if (ids.length === 0) return 0;

  await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: catalog.orgId, actorId, action: 'finding.carried_over', targetId: catalogId,
        payload: { catalogId, previousId: loaded.previousId, count: ids.length, accepted: decisions.filter((d) => d === 'accepted').length },
      },
    });
    await tx.$executeRaw`
      UPDATE finding f SET decision = v.dec::decision, "chosenMxik" = v.code,
        "decidedBy" = ${actorId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id}
      FROM unnest(${ids}::text[], ${decisions}::text[], ${codes}::text[]) AS v(id, dec, code)
      WHERE f.id = v.id AND f.decision = 'pending'::decision`;
  }, { timeout: 120_000 });
  return ids.length;
}

export type DiffNote = 'name' | 'unit' | 'code' | 'classifier' | 'nowRisky' | 'nowSafe';
export type DiffRow = { rowIndex: number; name: string; unit: string | null; code: string | null; notes?: DiffNote[] };
export type VersionDiff = {
  previousId: string;
  added: DiffRow[]; removed: DiffRow[]; changed: DiffRow[]; statusChanged: DiffRow[];
  counts: { added: number; removed: number; changed: number; statusChanged: number };
};

const LIMIT = 200;
const toRow = (i: VersionItem, notes?: DiffNote[]): DiffRow => ({ rowIndex: i.rowIndex, name: i.rawName, unit: i.unit, code: i.existingMxik, ...(notes ? { notes } : {}) });

/** What changed between a catalogue and the version it replaces. Null without a previous version. */
export async function versionDiff(orgId: string, catalogId: string): Promise<VersionDiff | null> {
  const loaded = await loadPairing(orgId, catalogId);
  if (!loaded) return null;
  const { pairing } = loaded;

  const risky = async (cid: string): Promise<Set<string>> => new Set((await db.finding.findMany({
    where: { item: { catalogId: cid }, severity: { in: ['high', 'medium'] } }, select: { itemId: true },
  })).map((f) => f.itemId));
  const [prevRisky, nextRisky, viaUpdate] = await Promise.all([
    risky(loaded.previousId), risky(catalogId),
    db.finding.findMany({ where: { item: { catalogId }, snapshotId: { not: null } }, select: { itemId: true } }),
  ]);
  const updated = new Set(viaUpdate.map((f) => f.itemId));

  const changed: DiffRow[] = [];
  const statusChanged: DiffRow[] = [];
  for (const { prev, next } of pairing.pairs) {
    if (!unchanged(prev, next)) {
      const what: DiffNote[] = [];
      if (prev.rawName !== next.rawName) what.push('name');
      if (prev.unit !== next.unit) what.push('unit');
      if (prev.existingMxik !== next.existingMxik) what.push('code');
      changed.push(toRow(next, what));
    } else if (prevRisky.has(prev.id) !== nextRisky.has(next.id)) {
      statusChanged.push(toRow(next, [updated.has(next.id) ? 'classifier' : nextRisky.has(next.id) ? 'nowRisky' : 'nowSafe']));
    }
  }
  return {
    previousId: loaded.previousId,
    added: pairing.added.slice(0, LIMIT).map((i) => toRow(i)),
    removed: pairing.removed.slice(0, LIMIT).map((i) => toRow(i)),
    changed: changed.slice(0, LIMIT),
    statusChanged: statusChanged.slice(0, LIMIT),
    counts: { added: pairing.added.length, removed: pairing.removed.length, changed: changed.length, statusChanged: statusChanged.length },
  };
}
