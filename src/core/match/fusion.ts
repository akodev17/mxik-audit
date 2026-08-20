// Reciprocal rank fusion. Pure: takes ranked lists, returns one ranked list.

/** Conventional RRF damping constant; 60 is the value from the original paper. */
export const RRF_K = 60;

export type RankedList<T> = {
  name: string;
  /** Most relevant first. */
  items: readonly T[];
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
    list.items.forEach((item, index) => {
      const key = keyOf(item);
      const rank = index + 1;
      const existing = acc.get(key);
      const contribution = 1 / (k + rank);
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

  // Best possible score is rank 1 in every non-empty list.
  const nonEmpty = lists.filter((l) => l.items.length > 0).length;
  const best = nonEmpty === 0 ? 1 : nonEmpty * (1 / (k + 1));
  const fused = [...acc.values()];
  for (const entry of fused) entry.normalized = Math.min(1, entry.score / best);

  // Deterministic order: score first, then key, so ties never shuffle between runs.
  return fused.sort((a, b) => b.score - a.score || keyOf(a.item).localeCompare(keyOf(b.item)));
}
