// The /queue URL: its filters read the way the domain's queue.ts reads them, the API query built
// from them, and the links that keep them. Pure copies of queue.ts readQueueFilter/workspaceHref and
// query-string.ts withQuery; tests/web-parity/params.test.ts keeps them equal.
import { FINDING_TYPES } from '@tasnivo/contracts';

export const QUEUE_DUE = ['overdue', 'week', 'month'] as const;
export type QueueDue = (typeof QUEUE_DUE)[number];

export type QueueFilter = {
  clientId: string | null;
  type: (typeof FINDING_TYPES)[number] | null;
  severity: 'high' | 'medium' | null;
  /** Rows marked "ask the client". */
  askClient: boolean;
  accountantId: string | null;
  /** Only clients with an open monthly check due in this window. */
  due: QueueDue | null;
};

type Params = { client?: string; type?: string; severity?: string; flag?: string; accountant?: string; due?: string };

export function readQueueFilter(p: Params): QueueFilter {
  return {
    clientId: p.client || null,
    type: FINDING_TYPES.find((t) => t === p.type) ?? null,
    severity: p.severity === 'high' || p.severity === 'medium' ? p.severity : null,
    askClient: p.flag === 'ask_client',
    accountantId: p.accountant || null,
    due: QUEUE_DUE.find((d) => d === p.due) ?? null,
  };
}

/**
 * The API's query for a filter and a cursor (`after`). Ids longer than the API takes match nothing
 * either way, and a cursor it would refuse decodes to "from the top" either way, so both are cut.
 */
export function queueQuery(f: QueueFilter, after: string | undefined) {
  return {
    ...(f.clientId ? { client: f.clientId.slice(0, 64) } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.askClient ? { flag: 'ask_client' } : {}),
    ...(f.accountantId ? { accountant: f.accountantId.slice(0, 64) } : {}),
    ...(f.due ? { due: f.due } : {}),
    ...(after ? { cursor: after.slice(0, 400) } : {}),
  };
}

/** Where a queue row opens: its catalogue, searched for the product, with the row's drawer open. */
export function workspaceHref(r: { catalogId: string; rawName: string; findingId: string }): string {
  const q = new URLSearchParams({ q: r.rawName.slice(0, 100), row: r.findingId });
  return `/catalogs/${r.catalogId}?${q}`;
}

type QueryParams = Record<string, string | string[] | undefined>;

/** `path` with the current params, `change` applied on top (null or '' removes a key). */
export function withQuery(path: string, current: QueryParams, change: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in change) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) q.set(key, v);
  }
  for (const [key, value] of Object.entries(change)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
