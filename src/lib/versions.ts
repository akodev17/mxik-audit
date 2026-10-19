// Catalogue versions: carry a client's earlier decisions over to the new upload,
// and describe what changed between the two.
import type { Prisma } from '@prisma/client';
import { pairVersions, unchanged, type Pairing } from '../core/match/version-pairs.js';
import { db } from './db.js';
import { CARRIED_OVER_ACTION } from './decision-source.js';
import { RISKY_FINDING } from './risk.js';
import { diffParts, type DiffParts } from './version-diff.js';

const CHUNK = 5000;
const ITEM_SELECT = { id: true, rowIndex: true, rawName: true, unit: true, barcode: true, existingMxik: true } as const;

async function chunked<T, R>(ids: readonly T[], fn: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await fn(ids.slice(i, i + CHUNK)));
  return out;
}

/**
 * Remembers the client's earlier ready catalogue as this one's previous
 * version. Called when the audit starts and again before decisions carry over,
 * so an earlier upload still being audited at the start is linked once ready.
 */
export async function linkPrevious(catalogId: string): Promise<void> {
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { id: true, orgId: true, clientId: true, previousId: true, createdAt: true } });
  if (!catalog || catalog.previousId || !catalog.clientId) return;
  const previous = await db.catalog.findFirst({ where: earlierReady(catalog), orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (previous) await db.catalog.updateMany({ where: { id: catalogId, previousId: null }, data: { previousId: previous.id } });
}

/** The client's audited catalogues uploaded before this one: what it can be a new version of. */
function earlierReady(c: { id: string; orgId: string; clientId: string | null; createdAt: Date }): Prisma.CatalogWhereInput {
  return { orgId: c.orgId, clientId: c.clientId, status: 'ready', id: { not: c.id }, createdAt: { lt: c.createdAt } };
}

/** Pairs this catalogue with its linked previous version, or with `againstId` (another of the same client). */
async function loadPairing(orgId: string, catalogId: string, againstId?: string): Promise<{ pairing: Pairing; previousId: string } | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId }, select: { id: true, orgId: true, previousId: true, clientId: true, createdAt: true } });
  const baseId = againstId ?? catalog?.previousId;
  if (!catalog || !baseId) return null;
  const previous = await db.catalog.findFirst({
    // The chosen id replaces "not this one"; being earlier already rules this one out.
    where: againstId ? { ...earlierReady(catalog), id: baseId } : { id: baseId, orgId },
    select: { id: true },
  });
  if (!previous) return null;
  // In row order: the pairing keeps it, so the (capped) lists show the file's rows in order.
  const [prevItems, nextItems] = await Promise.all([
    db.catalogItem.findMany({ where: { catalogId: previous.id }, orderBy: { rowIndex: 'asc' }, select: ITEM_SELECT }),
    db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' }, select: ITEM_SELECT }),
  ]);
  return { pairing: pairVersions(prevItems, nextItems), previousId: previous.id };
}

/**
 * Applies the previous version's decisions to rows that did not change: same
 * product, unit and code, same kind of finding, and an accepted code that is
 * still live. Everything else stays pending for review. Returns rows carried.
 * The carried decision keeps its original decider and is marked carry_over;
 * the uploader is recorded only as the one who triggered it.
 */
export async function carryOver(catalogId: string, actorId: string | null): Promise<number> {
  // The client's earlier upload may have finished its own audit while this one ran.
  await linkPrevious(catalogId);
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true } });
  if (!catalog) return 0;
  const loaded = await loadPairing(catalog.orgId, catalogId);
  if (!loaded) return 0;
  const same = loaded.pairing.pairs.filter((p) => unchanged(p.prev, p.next));
  if (same.length === 0) return 0;

  const prevByNext = new Map(same.map((p) => [p.next.id, p.prev.id]));
  const decided = await chunked(same.map((p) => p.prev.id), (part) => db.finding.findMany({
    where: { itemId: { in: part }, decision: { in: ['accepted', 'rejected'] } },
    select: { id: true, itemId: true, type: true, decision: true, chosenMxik: true, suggestedMxik: true, decidedBy: true },
  }));
  const decidedKey = new Map(decided.map((f) => [`${f.itemId}|${f.type}`, f]));
  const pending = await chunked([...prevByNext.keys()], (part) => db.finding.findMany({
    where: { itemId: { in: part }, decision: 'pending' },
    select: { id: true, itemId: true, type: true, suggestedMxik: true },
  }));

  const accepted = decided.flatMap((f) => (f.decision === 'accepted' && f.chosenMxik ? [f.chosenMxik] : []));
  const live = accepted.length === 0 ? new Set<string>() : new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${[...new Set(accepted)]}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));

  type Carried = { findingId: string; sourceFindingId: string; decision: 'accepted' | 'rejected'; chosenMxik: string | null; decidedBy: string | null };
  const carried: Carried[] = [];
  for (const f of pending) {
    const before = decidedKey.get(`${prevByNext.get(f.itemId) ?? ''}|${f.type}`);
    if (!before) continue;
    const from = { findingId: f.id, sourceFindingId: before.id, decidedBy: before.decidedBy };
    if (before.decision === 'accepted' && before.chosenMxik && live.has(before.chosenMxik)) {
      carried.push({ ...from, decision: 'accepted', chosenMxik: before.chosenMxik });
    } else if (before.decision === 'rejected' && before.suggestedMxik === f.suggestedMxik) {
      carried.push({ ...from, decision: 'rejected', chosenMxik: null });
    }
  }
  if (carried.length === 0) return 0;

  await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: catalog.orgId, actorId: null, action: CARRIED_OVER_ACTION, targetId: catalogId,
        payload: {
          catalogId, previousId: loaded.previousId, count: carried.length, accepted: carried.filter((c) => c.decision === 'accepted').length,
          source: 'carry_over', triggeredBy: actorId, findings: carried,
        },
      },
    });
    await tx.$executeRaw`
      UPDATE finding f SET decision = v.dec::decision, "chosenMxik" = v.code,
        "decidedBy" = v.by, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id}, "decisionSource" = 'carry_over'
      FROM unnest(${carried.map((c) => c.findingId)}::text[], ${carried.map((c) => c.decision)}::text[],
                  ${carried.map((c) => c.chosenMxik)}::text[], ${carried.map((c) => c.decidedBy)}::text[]) AS v(id, dec, code, by)
      WHERE f.id = v.id AND f.decision = 'pending'::decision`;
  }, { timeout: 120_000 });
  return carried.length;
}

export type { DiffNote, DiffRow } from './version-diff.js';

/** A decision copied from the previous version, with who originally made it. */
export type CarriedRow = {
  rowIndex: number;
  name: string;
  type: string;
  decision: 'accepted' | 'rejected';
  code: string | null;
  /** Email of the original decider; null for the system or a removed user. */
  decidedBy: string | null;
};

export type VersionDiff = DiffParts & {
  previousId: string;
  /** False when compared with a catalogue chosen by the user rather than the linked previous version. */
  linked: boolean;
  previous: { filename: string; createdAt: Date };
  carried: CarriedRow[];
  counts: DiffParts['counts'] & { carried: number };
};

const LIMIT = 200;

const itemIds = async (where: Prisma.FindingWhereInput): Promise<Set<string>> =>
  new Set((await db.finding.findMany({ where, select: { itemId: true } })).map((f) => f.itemId));

async function carriedRows(orgId: string, catalogId: string): Promise<{ rows: CarriedRow[]; count: number }> {
  const where: Prisma.FindingWhereInput = { item: { catalogId }, decisionSource: 'carry_over', decision: { not: 'pending' } };
  const [count, found] = await Promise.all([
    db.finding.count({ where }),
    db.finding.findMany({
      where, orderBy: [{ item: { rowIndex: 'asc' } }, { type: 'asc' }], take: LIMIT,
      select: { type: true, decision: true, chosenMxik: true, decidedBy: true, item: { select: { rowIndex: true, rawName: true } } },
    }),
  ]);
  const users = await db.user.findMany({
    where: { orgId, id: { in: [...new Set(found.flatMap((f) => (f.decidedBy ? [f.decidedBy] : [])))] } },
    select: { id: true, email: true },
  });
  const emails = new Map(users.map((u) => [u.id, u.email]));
  return {
    count,
    rows: found.map((f) => ({
      rowIndex: f.item.rowIndex, name: f.item.rawName, type: f.type,
      decision: f.decision === 'accepted' ? 'accepted' : 'rejected',
      code: f.chosenMxik,
      decidedBy: f.decidedBy ? emails.get(f.decidedBy) ?? null : null,
    })),
  };
}

/**
 * What changed between a catalogue and the version it replaces, or another
 * ready catalogue of the same client (`againstId`). Decisions carried over are
 * listed only against the linked previous version, the one they came from.
 * Null when there is nothing to compare with.
 */
export async function versionDiff(orgId: string, catalogId: string, againstId?: string): Promise<VersionDiff | null> {
  const loaded = await loadPairing(orgId, catalogId, againstId);
  if (!loaded) return null;
  const { previousId } = loaded;
  const linked = (await db.catalog.count({ where: { id: catalogId, orgId, previousId } })) > 0;
  const [previous, prevRisky, nextRisky, updated, prevDecided, nextPending, carried] = await Promise.all([
    db.catalog.findUniqueOrThrow({ where: { id: previousId }, select: { filename: true, createdAt: true } }),
    itemIds({ item: { catalogId: previousId }, ...RISKY_FINDING }),
    itemIds({ item: { catalogId }, ...RISKY_FINDING }),
    itemIds({ item: { catalogId }, snapshotId: { not: null } }),
    itemIds({ item: { catalogId: previousId }, decision: { in: ['accepted', 'rejected'] } }),
    itemIds({ item: { catalogId }, ...RISKY_FINDING, decision: 'pending' }),
    linked ? carriedRows(orgId, catalogId) : { rows: [], count: 0 },
  ]);
  const parts = diffParts(loaded.pairing, { prevRisky, nextRisky, updated, prevDecided, nextPending }, LIMIT);
  return { ...parts, previousId, linked, previous, carried: carried.rows, counts: { ...parts.counts, carried: carried.count } };
}

export type CompareCandidate = { id: string; filename: string; createdAt: Date };

/** The client's other ready catalogues, newest first: what a catalogue without a linked version can be compared with. */
export async function compareCandidates(orgId: string, catalogId: string): Promise<CompareCandidate[]> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId }, select: { id: true, orgId: true, clientId: true, createdAt: true } });
  if (!catalog?.clientId) return [];
  return db.catalog.findMany({ where: earlierReady(catalog), orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, filename: true, createdAt: true } });
}
