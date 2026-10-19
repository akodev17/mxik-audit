// What changed between two versions of a client's catalogue, from a pairing of
// their rows (src/core/match/version-pairs.ts decides identity; nothing here
// loosens it). Pure.
import { unchanged, type Pairing, type VersionItem } from '../core/match/version-pairs.js';

export type DiffNote = 'name' | 'unit' | 'code' | 'barcode' | 'identity' | 'classifier' | 'nowRisky' | 'nowSafe';
export type DiffRow = { rowIndex: number; name: string; unit: string | null; code: string | null; notes?: DiffNote[] };

export type DiffSets = {
  /** Items with a high or medium finding, in the previous and in this version. */
  prevRisky: ReadonlySet<string>;
  nextRisky: ReadonlySet<string>;
  /** Items of this version with a finding raised by a classifier update. */
  updated: ReadonlySet<string>;
  /** Previous-version items with an accepted or rejected finding. */
  prevDecided: ReadonlySet<string>;
  /** Items of this version with a risky finding still pending. */
  nextPending: ReadonlySet<string>;
};

export type DiffCounts = { added: number; removed: number; changed: number; unchanged: number; statusChanged: number; reReview: number };

export type DiffParts = {
  added: DiffRow[]; removed: DiffRow[]; changed: DiffRow[]; statusChanged: DiffRow[]; reReview: DiffRow[];
  counts: DiffCounts;
};

export const toDiffRow = (i: VersionItem, notes?: DiffNote[]): DiffRow =>
  ({ rowIndex: i.rowIndex, name: i.rawName, unit: i.unit, code: i.existingMxik, ...(notes ? { notes } : {}) });

const same = (a: string | null, b: string | null): boolean => (a ?? '').trim() === (b ?? '').trim();

/** Which visible fields differ; "identity" when none does but the rows still cannot be treated as the same product. */
export function changedFields(prev: VersionItem, next: VersionItem): DiffNote[] {
  const what: DiffNote[] = [];
  if (!same(prev.rawName, next.rawName)) what.push('name');
  if (!same(prev.unit, next.unit)) what.push('unit');
  if (!same(prev.existingMxik, next.existingMxik)) what.push('code');
  if (!same(prev.barcode, next.barcode)) what.push('barcode');
  return what.length > 0 ? what : ['identity'];
}

/** Classifies every paired row once; lists are capped at `limit`, counts are not. */
export function diffParts(pairing: Pairing, sets: DiffSets, limit: number): DiffParts {
  const changed: DiffRow[] = [];
  const statusChanged: DiffRow[] = [];
  const reReview: DiffRow[] = [];
  let unchangedCount = 0;
  for (const { prev, next } of pairing.pairs) {
    const isSame = unchanged(prev, next);
    if (!isSame) changed.push(toDiffRow(next, changedFields(prev, next)));
    else {
      unchangedCount++;
      if (sets.prevRisky.has(prev.id) !== sets.nextRisky.has(next.id)) {
        statusChanged.push(toDiffRow(next, [sets.updated.has(next.id) ? 'classifier' : sets.nextRisky.has(next.id) ? 'nowRisky' : 'nowSafe']));
      }
    }
    // Decided last time, open again now: the row changed, or its decision could not be carried.
    if (sets.prevDecided.has(prev.id) && sets.nextPending.has(next.id)) {
      reReview.push(toDiffRow(next, isSame ? undefined : changedFields(prev, next)));
    }
  }
  return {
    added: pairing.added.slice(0, limit).map((i) => toDiffRow(i)),
    removed: pairing.removed.slice(0, limit).map((i) => toDiffRow(i)),
    changed: changed.slice(0, limit),
    statusChanged: statusChanged.slice(0, limit),
    reReview: reReview.slice(0, limit),
    counts: {
      added: pairing.added.length, removed: pairing.removed.length, changed: changed.length,
      unchanged: unchangedCount, statusChanged: statusChanged.length, reReview: reReview.length,
    },
  };
}
