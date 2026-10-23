// The workspace filter and saved views as the URL carries them, and where a decision came from.
// Pure copies of @tasnivo/domain workspace-filter.ts, view-params.ts and decision-source.ts (the
// API re-reads every filter with the domain's readFilter); workspace-url.test.ts keeps them equal.
import {
  DECISION_FILTERS, DECISION_SOURCES, FINDING_TYPES, FLAG_FILTERS, OPTIONAL_COLUMNS,
  type ViewParams as ViewParamsSchema,
} from '@tasnivo/contracts';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { z } from 'zod';

export { DECISION_FILTERS, DECISION_SOURCES, FINDING_TYPES, FLAG_FILTERS, OPTIONAL_COLUMNS };

export type DecisionSource = (typeof DECISION_SOURCES)[number];
export type WsType = (typeof FINDING_TYPES)[number];
export type WsDecisionFilter = (typeof DECISION_FILTERS)[number];
export type WsFlagFilter = (typeof FLAG_FILTERS)[number];
export type WsSort = 'risk' | 'row';
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
export type ViewParams = z.infer<typeof ViewParamsSchema>;

/** A finding type, markirovka, or null for every risky finding. `source`: only decisions made this way. */
export type WsFilter = {
  type: WsType | 'MARKING' | null;
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

const KNOWN_SOURCES = new Set<string>(DECISION_SOURCES);

export function readDecisionSource(value: unknown): DecisionSource | null {
  return typeof value === 'string' && KNOWN_SOURCES.has(value) ? (value as DecisionSource) : null;
}

/** True when no person decided this finding in this catalogue. */
export function isAutomatic(source: DecisionSource | null): boolean {
  return source === 'dictionary_auto' || source === 'carry_over';
}

export function decisionSourceLabel(source: DecisionSource, ta: AppDict): string {
  return ta.matchX.decisionSource[source];
}

const pick = <T extends string>(list: readonly T[], value: string | null | undefined): T | null =>
  list.find((x) => x === value) ?? null;

/**
 * `pending=0` is the older spelling of `dec=all`; links and saved views from before keep working.
 * A decision source without `dec` means every decision state: a pending row has no source.
 */
export function readFilter(p: FilterParams): WsFilter {
  const type = p.type === 'MARKING' ? 'MARKING' : pick(FINDING_TYPES, p.type);
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

/**
 * The filter as the API reads it back (contracts FilterInput, re-read by readFilter on the server):
 * filterQuery, plus an explicit `dec=pending` next to a source, which readFilter would otherwise
 * widen to every decision state. readFilter(apiFilter(f)) equals f for every f.
 */
export function apiFilter(f: WsFilter): Record<string, string> {
  const out = filterQuery(f);
  if (f.source && f.decision === 'pending') out['dec'] = 'pending';
  return out;
}

/** Stable key of everything that changes which rows load; the grid remounts when it changes. */
export function filterKey(f: WsFilter): string {
  return [f.type ?? '', f.q, f.decision, f.flag, f.commented ? 1 : 0, f.sort, f.source ?? ''].join('|');
}

/** Reads the `cols` URL value ("status,match") into hidden columns; unknown names are dropped. */
export function readHidden(raw: string | null | undefined): OptionalColumn[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(','));
  return OPTIONAL_COLUMNS.filter((c) => wanted.has(c));
}

/** Query string that opens the workspace in this view. `v=0` marks it as chosen, so the default view is not applied again. */
export function viewQuery(p: ViewParams): string {
  const q = new URLSearchParams({ v: '0' });
  const decision = p.decision ?? (p.pending ? 'pending' : 'all');
  if (p.type) q.set('type', p.type);
  if (p.q) q.set('q', p.q);
  if (decision !== 'pending') q.set('dec', decision);
  if (p.flag && p.flag !== 'any') q.set('flag', p.flag);
  if (p.source) q.set('source', p.source);
  if (p.comments) q.set('comments', '1');
  if (p.sort !== 'risk') q.set('sort', p.sort);
  if (p.density === 'compact') q.set('density', 'compact');
  if (p.grouped) q.set('grouped', '1');
  if (p.hidden && p.hidden.length > 0) q.set('cols', p.hidden.join(','));
  return q.toString();
}
