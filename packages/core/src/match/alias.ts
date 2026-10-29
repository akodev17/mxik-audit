// Global aliases: product names that several organisations, independently,
// confirmed to one code (plan §11). Learned per org from individual and group
// decisions (never bulk accepts), listed as candidates once two organisations
// agree, and active only after a platform admin approves them. The matcher
// reads approved aliases as one more retrieval signal: the alias code enters
// the fused pool with its own evidence line ("N tashkilot tasdiqlagan"). It
// never overrides a barcode identity or the org's own dictionary.
import { normalizeName } from '../normalize/index.js';

export type AliasHit = {
  code: string;
  /** Distinct organisations that confirmed the code for this name. */
  orgs: number;
  /** Individual and group confirmations behind it, all organisations together. */
  confirmations: number;
};

/** Lookup supplied by the caller (the domain loads the approved aliases). */
export type AliasLookup = {
  find(key: string): readonly AliasHit[];
};

/** The key an alias is learned and found under: the name's folded, word-sorted key, no unit. */
export function aliasKey(rawName: string): string {
  return normalizeName(rawName).sortedKey;
}

/** Organisations that must agree before a name becomes an alias candidate. */
export const ALIAS_MIN_ORGS = 2;

/** Most alias codes the pipeline adds to the reranker pool beyond the fused window. */
export const ALIAS_SLOTS = 3;

/** An in-memory lookup, for tests and for the domain's loaded table. */
export function aliasLookup(entries: readonly { key: string; code: string; orgs: number; confirmations: number }[]): AliasLookup & { size: number } {
  const byKey = new Map<string, AliasHit[]>();
  for (const e of entries) {
    const hits = byKey.get(e.key) ?? [];
    hits.push({ code: e.code, orgs: e.orgs, confirmations: e.confirmations });
    byKey.set(e.key, hits);
  }
  for (const hits of byKey.values()) hits.sort((a, b) => b.orgs - a.orgs || b.confirmations - a.confirmations || a.code.localeCompare(b.code));
  return { size: entries.length, find: (key) => byKey.get(key) ?? [] };
}
