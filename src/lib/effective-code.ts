// One catalogue row, one code. Pure.
//
// The rule: a finding may be accepted with code X only while no other finding
// of the same row is accepted with a different code. The reviewer undoes the
// other decision first (decisions return a typed `sibling_conflict`, bulk and
// group actions skip such rows and report them). Rows decided before the rule
// existed may still hold two accepted codes; then the latest acceptance wins,
// which is what effectiveDecision returns and what an export should write.

export type ItemFinding = {
  id: string;
  type: string;
  decision: 'pending' | 'accepted' | 'rejected';
  chosenMxik: string | null;
  decidedAt: Date | string | null;
};

export type EffectiveDecision =
  | { state: 'accepted'; code: string; findingId: string }
  | { state: 'rejected'; findingId: string }
  | { state: 'pending' };

const time = (f: ItemFinding): number => (f.decidedAt === null ? 0 : new Date(f.decidedAt).getTime());

/** Newest first; equal times fall back to the id so the answer never depends on input order. */
function newestFirst(a: ItemFinding, b: ItemFinding): number {
  return time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** The decision that counts for a row: the latest acceptance with a code, else the latest rejection, else pending. */
export function effectiveDecision(itemFindings: readonly ItemFinding[]): EffectiveDecision {
  const accepted = itemFindings.filter((f) => f.decision === 'accepted' && f.chosenMxik).sort(newestFirst)[0];
  if (accepted?.chosenMxik) return { state: 'accepted', code: accepted.chosenMxik, findingId: accepted.id };
  const rejected = itemFindings.filter((f) => f.decision === 'rejected').sort(newestFirst)[0];
  return rejected ? { state: 'rejected', findingId: rejected.id } : { state: 'pending' };
}

/** Another finding of the row already accepted with a different code, which blocks accepting `code`. */
export function conflictingSibling(itemFindings: readonly ItemFinding[], findingId: string, code: string): ItemFinding | null {
  return itemFindings.find((f) => f.id !== findingId && f.decision === 'accepted' && f.chosenMxik !== null && f.chosenMxik !== code) ?? null;
}

/**
 * For a batch of acceptances: ids whose row already holds another code, or
 * whose row gets two different codes within the batch. Both are skipped.
 */
export function batchConflicts(
  targets: readonly { id: string; itemId: string; code: string }[],
  acceptedByItem: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const codesInBatch = new Map<string, Set<string>>();
  for (const t of targets) codesInBatch.set(t.itemId, (codesInBatch.get(t.itemId) ?? new Set()).add(t.code));
  return new Set(targets.filter((t) => {
    const already = acceptedByItem.get(t.itemId) ?? [];
    return already.some((c) => c !== t.code) || (codesInBatch.get(t.itemId)?.size ?? 0) > 1;
  }).map((t) => t.id));
}
