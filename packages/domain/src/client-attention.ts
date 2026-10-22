// Why a client without an audited catalogue needs attention: nothing uploaded
// yet, or a catalogue whose audit failed, is still running or never started.
// client-stats only knows "no audited catalogue"; this reads which case it is.
import { attentionReasons, type ClientStats, type Reason } from './client-stats';
import { db } from '@tasnivo/db';

export type PendingAudit = 'failed' | 'analyzing' | 'uploaded';
export type AttentionReason = Reason | { kind: PendingAudit; count: number };

type Unaudited = Pick<ClientStats, 'id' | 'catalogId' | 'catalogs'>;

/** Status of the newest catalogue of each client that has catalogues but none audited. */
export async function pendingAudits(orgId: string, clients: readonly Unaudited[]): Promise<Map<string, PendingAudit>> {
  const ids = clients.filter((c) => !c.catalogId && c.catalogs > 0).map((c) => c.id);
  if (ids.length === 0) return new Map();
  const latest = await db.catalog.findMany({
    where: { orgId, clientId: { in: ids } },
    orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['clientId'],
    select: { clientId: true, status: true },
  });
  return new Map(latest.flatMap((c) => (c.clientId && c.status !== 'ready' ? [[c.clientId, c.status] as const] : [])));
}

/** attentionReasons, with "no catalogue" told apart from a failed, running or unstarted audit. */
export function clientAttention(c: Parameters<typeof attentionReasons>[0] & Pick<ClientStats, 'id'>, pending: ReadonlyMap<string, PendingAudit>): AttentionReason[] {
  const status = pending.get(c.id);
  return attentionReasons(c).map((r): AttentionReason => (r.kind === 'empty' && status ? { kind: status, count: 0 } : r));
}
