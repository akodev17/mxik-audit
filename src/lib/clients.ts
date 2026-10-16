// Clients of an organization: an accounting firm's customers, or a company's
// single default client. Every query is scoped by org id; a client id alone
// never reaches another org's data.
import { db } from './db.js';
import type { Actor, Result } from './decisions.js';
import { latestPerClient } from './notifications.js';
import { RISKY_ITEM } from './risk.js';

export type ClientRef = { id: string; name: string; isDefault: boolean };

/** The org's default client, created on first use (the catalogue trigger does the same). */
export async function defaultClient(orgId: string): Promise<ClientRef> {
  const found = await db.client.findFirst({ where: { orgId, isDefault: true }, select: { id: true, name: true, isDefault: true } });
  if (found) return found;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  await db.$executeRaw`
    INSERT INTO client (id, "orgId", name, "isDefault")
    VALUES ('cl' || md5(${orgId}), ${orgId}, ${org.name}, true)
    ON CONFLICT ("orgId") WHERE "isDefault" DO NOTHING`;
  return db.client.findFirstOrThrow({ where: { orgId, isDefault: true }, select: { id: true, name: true, isDefault: true } });
}

/** The requested client when it is the org's, otherwise the default one. */
export async function resolveClient(orgId: string, clientId?: string | null): Promise<ClientRef> {
  if (clientId) {
    const client = await db.client.findFirst({ where: { id: clientId, orgId }, select: { id: true, name: true, isDefault: true } });
    if (client) return client;
  }
  return defaultClient(orgId);
}

/** Strictly the org's client, or null: for writes, where falling back would misfile data. */
export async function ownedClient(orgId: string, clientId: string): Promise<ClientRef | null> {
  return db.client.findFirst({ where: { id: clientId, orgId }, select: { id: true, name: true, isDefault: true } });
}

export async function createClient(actor: Actor, name: string): Promise<Result<{ clientId: string }>> {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 2 || clean.length > 200) return { ok: false, error: 'bad name' };
  const client = await db.client.create({ data: { orgId: actor.orgId, name: clean } });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'client.created', targetId: client.id, payload: { clientId: client.id, name: clean } },
  });
  return { ok: true, clientId: client.id };
}

export type AuditPoint = { catalogId: string; createdAt: Date; riskyRows: number; rowCount: number };

export type ClientSummary = ClientRef & {
  catalogCount: number;
  lastAuditAt: Date | null;
  /** Risky rows in the last five audited catalogues, oldest first. */
  trend: AuditPoint[];
  /** Rows of the latest audited catalogue whose code requires marking. */
  markingRows: number;
  lastNotification: { title: string; createdAt: Date } | null;
};

const TREND_LENGTH = 5;

export async function listClients(orgId: string, scope?: string[] | null): Promise<ClientSummary[]> {
  await defaultClient(orgId);
  const clients = await db.client.findMany({
    where: { orgId, ...(scope ? { id: { in: scope } } : {}) },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, isDefault: true,
      _count: { select: { catalogs: true } },
      catalogs: {
        where: { status: 'ready' },
        orderBy: { createdAt: 'desc' },
        take: TREND_LENGTH,
        select: { id: true, createdAt: true, rowCount: true, _count: { select: { items: { where: RISKY_ITEM } } } },
      },
    },
  });
  const latestIds = clients.flatMap((c) => (c.catalogs[0] ? [c.catalogs[0].id] : []));
  const marking = latestIds.length === 0 ? [] : await db.catalogItem.groupBy({
    by: ['catalogId'],
    where: { catalogId: { in: latestIds }, markingRequired: true },
    _count: { _all: true },
  });
  const markingBy = new Map(marking.map((m) => [m.catalogId, m._count._all]));
  const notices = await latestPerClient(orgId, clients.map((c) => c.id));

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.isDefault,
    catalogCount: c._count.catalogs,
    lastAuditAt: c.catalogs[0]?.createdAt ?? null,
    trend: [...c.catalogs].reverse().map((k) => ({
      catalogId: k.id, createdAt: k.createdAt, rowCount: k.rowCount, riskyRows: k._count.items,
    })),
    markingRows: c.catalogs[0] ? markingBy.get(c.catalogs[0].id) ?? 0 : 0,
    lastNotification: notices.get(c.id) ?? null,
  }));
}

const HISTORY_ACTIONS = ['catalog.uploaded', 'catalog.audited', 'catalog.exported', 'catalog.deleted', 'client.created', 'classifier.updated'];

export type ClientEvent = { id: string; action: string; createdAt: Date; payload: Record<string, unknown> };

/** What happened to a client's catalogues, newest first. */
export async function clientHistory(orgId: string, clientId: string, limit = 40): Promise<ClientEvent[]> {
  const catalogIds = (await db.catalog.findMany({ where: { orgId, clientId }, select: { id: true } })).map((c) => c.id);
  const events = await db.auditEvent.findMany({
    where: {
      orgId,
      action: { in: HISTORY_ACTIONS },
      OR: [{ targetId: { in: [...catalogIds, clientId] } }, { payload: { path: ['clientId'], equals: clientId } }],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, createdAt: true, payload: true },
  });
  return events.map((e) => ({
    ...e,
    payload: typeof e.payload === 'object' && e.payload !== null && !Array.isArray(e.payload) ? e.payload as Record<string, unknown> : {},
  }));
}
