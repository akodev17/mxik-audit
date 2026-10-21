// Reciprocal rank fusion. Pure: takes ranked lists, returns one ranked list.

/** Conventional RRF damping constant; 60 is the value from the original paper. */
export const RRF_K = 60;

export type RankedList<T> = {
  name: string;
  /** Most relevant first. */
  items: readonly T[];
  /**
   * How much a rank in this list counts, 1 by default. Lowered for a list that
   * is known to be weak (the non-semantic vector stand-in); 0 leaves it out.
   */
  weight?: number;
};

export type FusedItem<T> = {
  item: T;
  /** Raw RRF score, the sum of 1/(k+rank) over the lists containing the item. */
  score: number;
  /** `score` divided by the best score achievable, so it lands in 0..1. */
  normalized: number;
  /** 1-based rank in each contributing list. */
  ranks: Record<string, number>;
};

/**
 * Fuses ranked lists by reciprocal rank. Items appearing high in several lists
 * beat items ranked first in only one, which is the point: it rewards agreement
 * between the lexical and vector stages without needing their scores to be on a
 * comparable scale.
 */
export function reciprocalRankFusion<T>(
  lists: readonly RankedList<T>[],
  keyOf: (item: T) => string,
  k: number = RRF_K,
): FusedItem<T>[] {
  const acc = new Map<string, FusedItem<T>>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    if (weight <= 0) continue;
    list.items.forEach((item, index) => {
      const key = keyOf(item);
      const rank = index + 1;
      const existing = acc.get(key);
      const contribution = weight / (k + rank);
      if (existing) {
        existing.score += contribution;
        existing.ranks[list.name] = rank;
      } else {
        acc.set(key, {
          item,
          score: contribution,
          normalized: 0,
          ranks: { [list.name]: rank },
        });
      }
    });
  }

  // Best possible score is rank 1 in every non-empty list, each at its weight.
  const weights = lists.filter((l) => l.items.length > 0 && (l.weight ?? 1) > 0).reduce((sum, l) => sum + (l.weight ?? 1), 0);
  const best = weights === 0 ? 1 : weights * (1 / (k + 1));
  const fused = [...acc.values()];
  for (const entry of fused) entry.normalized = Math.min(1, entry.score / best);

  // Deterministic order: score first, then key, so ties never shuffle between runs.
  return fused.sort((a, b) => b.score - a.score || keyOf(a.item).localeCompare(keyOf(b.item)));
}

/**
 * Position-level fusion (plan §3.2). Fusion per code splits a position's
 * evidence across its many near-identical codes (150 pipe sizes each get one
 * rank), so a wrong position with a single code can win. This pass sums every
 * list's reciprocal ranks per group (a subposition), so the group whose codes
 * fill the top of the lists scores highest, and returns each group's score
 * divided by the best group's: 1 for the leading group, less for the rest.
 */
export function groupFusion<T>(
  lists: readonly RankedList<T>[],
  groupOf: (item: T) => string,
  k: number = RRF_K,
  /** Count at most this many codes per group per list, so sheer size cannot win alone. */
  cap: number = Number.POSITIVE_INFINITY,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    if (weight <= 0) continue;
    const seen = new Map<string, number>();
    list.items.forEach((item, index) => {
      const group = groupOf(item);
      const n = (seen.get(group) ?? 0) + 1;
      seen.set(group, n);
      if (n > cap) return;
      scores.set(group, (scores.get(group) ?? 0) + weight / (k + index + 1));
    });
  }
  const best = Math.max(0, ...scores.values());
  if (best > 0) for (const [group, score] of scores) scores.set(group, score / best);
  return scores;
}
