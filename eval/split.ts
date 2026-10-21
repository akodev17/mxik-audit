// A fixed 20% hold-out per case set, for fitting weights on the rest (plan
// §3.6, §12 "hold out 20% of each real set when fitting"). Pure and
// deterministic: the same ids always land on the same side, whatever order the
// files are read in, so a fit and the eval that reports it agree.
import { setOf } from './metrics.js';

export const HOLDOUT_SHARE = 0.2;

/** FNV-1a, 32 bit: a stable shuffle key per case id. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Ids held out: in every set, the ceil(20%) whose hashed ids sort first. */
export function holdoutIds(ids: readonly string[], share: number = HOLDOUT_SHARE): Set<string> {
  const sets = new Map<string, string[]>();
  for (const id of ids) sets.set(setOf(id), [...(sets.get(setOf(id)) ?? []), id]);
  const out = new Set<string>();
  for (const members of sets.values()) {
    const ordered = [...members].sort((a, b) => fnv1a(a) - fnv1a(b) || a.localeCompare(b));
    for (const id of ordered.slice(0, Math.ceil(members.length * share))) out.add(id);
  }
  return out;
}
