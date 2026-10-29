// The workspace filter: what the URL says, parsed and written back. Pure, so the
// server pages, the server actions and the client toolbar share one reading.
import { z } from 'zod';
import { readDecisionSource, type DecisionSource } from './decision-source';

export const FINDING_TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY', 'RESTRICTED'] as const;
export type WsType = (typeof FINDING_TYPES)[number];

/** pending (default), every decision state, or one of them; `auto` = decided by the system (dictionary auto-accept, carry-over). */
export const DECISION_FILTERS = ['pending', 'all', 'accepted', 'rejected', 'carried', 'auto'] as const;
export type WsDecisionFilter = (typeof DECISION_FILTERS)[number];

/** Investigation flag: any, waiting on the client, settled, or no flag. */
export const FLAG_FILTERS = ['any', 'ask_client', 'resolved', 'none'] as const;
export type WsFlagFilter = (typeof FLAG_FILTERS)[number];

export type WsSort = 'risk' | 'row';

/** A finding type, markirovka, rows whose check failed (FAILED), or null for every risky finding. `source`: only decisions made this way (Finding.decisionSource). */
export type WsFilter = {
  type: WsType | 'MARKING' | 'FAILED' | null;
  q: string;
  decision: WsDecisionFilter;
  flag: WsFlagFilter;
  commented: boolean;
  sort: WsSort;
  source: DecisionSource | null;
};

export type FilterParams = {
  type?: string | null; q?: string | null; pending?: string | null; dec?: string | null;
  flag?: string | null; comments?: string | null; sort?: string | null; source?: string | null;
};

/** A filter as server actions receive it from the browser: URL-shaped strings, re-read by readFilter. */
export const FilterInput = z.object({
  type: z.string().max(40).nullish(),
  q: z.string().max(100).nullish(),
  dec: z.string().max(20).nullish(),
  flag: z.string().max(20).nullish(),
  comments: z.string().max(2).nullish(),
  sort: z.string().max(10).nullish(),
  source: z.string().max(20).nullish(),
});

const pick = <T extends string>(list: readonly T[], value: string | null | undefined): T | null =>
  list.find((x) => x === value) ?? null;

/**
 * `pending=0` is the older spelling of `dec=all`; links and saved views from before keep working.
 * A decision source without `dec` means every decision state: a pending row has no source.
 */
export function readFilter(p: FilterParams): WsFilter {
  const type = p.type === 'MARKING' || p.type === 'FAILED' ? p.type : pick(FINDING_TYPES, p.type);
  const source = readDecisionSource(p.source);
  const decision = pick(DECISION_FILTERS, p.dec) ?? (p.pending === '0' || source ? 'all' : 'pending');
  return {
    type,
    q: (p.q ?? '').trim().slice(0, 100),
    decision,
    flag: pick(FLAG_FILTERS, p.flag) ?? 'any',
    commented: p.comments === '1',
    sort: p.sort === 'row' ? 'row' : 'risk',
    source,
  };
}

/** Query-string pairs for a filter; defaults are left out. */
export function filterQuery(f: WsFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.type) out['type'] = f.type;
  if (f.q) out['q'] = f.q;
  if (f.decision !== 'pending') out['dec'] = f.decision;
  if (f.flag !== 'any') out['flag'] = f.flag;
  if (f.commented) out['comments'] = '1';
  if (f.sort !== 'risk') out['sort'] = f.sort;
  if (f.source) out['source'] = f.source;
  return out;
}

/** True when the filter narrows the default "every pending risky finding" view. */
export function isNarrowed(f: WsFilter): boolean {
  return f.type !== null || f.q !== '' || f.flag !== 'any' || f.commented || f.decision !== 'pending' || f.source !== null;
}

/**
 * The pending part of a filter, for decisions that only touch pending rows;
 * null when the filter shows decided rows only, so nothing can be decided.
 */
export function pendingSubset(f: WsFilter): WsFilter | null {
  if (f.decision === 'pending' || f.decision === 'all') return { ...f, decision: 'pending' };
  return null;
}

/** Stable key of everything that changes which rows load; the grid remounts when it changes. */
export function filterKey(f: WsFilter): string {
  return [f.type ?? '', f.q, f.decision, f.flag, f.commented ? 1 : 0, f.sort, f.source ?? ''].join('|');
}
