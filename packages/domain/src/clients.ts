// Clients of an organization: an accounting firm's customers, or a company's
// single default client. Every query is scoped by org id; a client id alone
// never reaches another org's data.
import type { UserRole } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { Actor, Result } from './decisions.js';

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

/** The org's client when it is not archived, or null: for writes that must not land in an archived client. */
export async function activeOwnedClient(orgId: string, clientId: string): Promise<ClientRef | null> {
  return db.client.findFirst({ where: { id: clientId, orgId, archivedAt: null }, select: { id: true, name: true, isDefault: true } });
}

/** Collapses whitespace; null when the name is too short or too long. */
export function cleanClientName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length < 2 || clean.length > 200 ? null : clean;
}

/**
 * Creates a client. A scoped creator (one limited to assigned clients) is
 * assigned to it in the same transaction, so the new client never 404s for
 * the person who made it. Viewers cannot create clients.
 */
export async function createClient(actor: Actor & { role: UserRole }, name: string): Promise<Result<{ clientId: string }>> {
  if (actor.role === 'viewer') return { ok: false, error: 'forbidden' };
  const clean = cleanClientName(name);
  if (!clean) return { ok: false, error: 'bad name' };
  const scoped = actor.role !== 'admin' && actor.clientIds != null;
  const client = await db.$transaction(async (tx) => {
    const created = await tx.client.create({ data: { orgId: actor.orgId, name: clean }, select: { id: true } });
    if (scoped) await tx.clientAssignment.create({ data: { userId: actor.userId, clientId: created.id } });
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'client.created', targetId: created.id,
        payload: { clientId: created.id, name: clean, assignedToCreator: scoped },
      },
    });
    return created;
  });
  return { ok: true, clientId: client.id };
}
