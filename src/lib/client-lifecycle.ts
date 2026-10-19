// Admin-only changes to a client: rename, archive, restore, delete, and who is
// assigned to it. Each change is one audit event; the default client cannot be
// archived or deleted (uploads without a client land there).
import type { UserRole } from '@prisma/client';
import { deleteCatalog } from './catalogs.js';
import { cleanClientName } from './clients.js';
import { db } from './db.js';

export type AdminActor = { orgId: string; userId: string; role: UserRole };

export type LifecycleError = 'forbidden' | 'not found' | 'bad name' | 'default' | 'name mismatch' | 'archived' | 'unrestricted' | 'last' | 'bad user';

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: LifecycleError };

async function adminClient(actor: AdminActor, clientId: string) {
  if (actor.role !== 'admin') return null;
  return db.client.findFirst({ where: { id: clientId, orgId: actor.orgId }, select: { id: true, name: true, isDefault: true, archivedAt: true } });
}

function event(actor: AdminActor, action: string, clientId: string, payload: Record<string, unknown>) {
  return db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action, targetId: clientId, payload: { clientId, ...payload } } });
}

export async function renameClient(actor: AdminActor, clientId: string, name: string): Promise<Outcome> {
  const client = await adminClient(actor, clientId);
  if (!client) return { ok: false, error: actor.role === 'admin' ? 'not found' : 'forbidden' };
  const clean = cleanClientName(name);
  if (!clean) return { ok: false, error: 'bad name' };
  if (clean === client.name) return { ok: true };
  await db.$transaction([
    db.client.update({ where: { id: client.id }, data: { name: clean } }),
    event(actor, 'client.renamed', client.id, { from: client.name, name: clean }),
  ]);
  return { ok: true };
}

/** Hides the client from lists, the switcher, the queue and reminders; its data stays and it can be restored. */
export async function archiveClient(actor: AdminActor, clientId: string, now = new Date()): Promise<Outcome> {
  const client = await adminClient(actor, clientId);
  if (!client) return { ok: false, error: actor.role === 'admin' ? 'not found' : 'forbidden' };
  if (client.isDefault) return { ok: false, error: 'default' };
  if (client.archivedAt) return { ok: true };
  await db.$transaction([
    db.client.update({ where: { id: client.id }, data: { archivedAt: now } }),
    event(actor, 'client.archived', client.id, { name: client.name }),
  ]);
  return { ok: true };
}

export async function restoreClient(actor: AdminActor, clientId: string): Promise<Outcome> {
  const client = await adminClient(actor, clientId);
  if (!client) return { ok: false, error: actor.role === 'admin' ? 'not found' : 'forbidden' };
  if (!client.archivedAt) return { ok: true };
  await db.$transaction([
    db.client.update({ where: { id: client.id }, data: { archivedAt: null } }),
    event(actor, 'client.restored', client.id, { name: client.name }),
  ]);
  return { ok: true };
}

/**
 * Deletes the client and all its data after the admin typed its exact name.
 * Each catalogue goes through deleteCatalog (tombstone, cached verdicts
 * dropped); audit events are kept.
 */
export async function deleteClient(actor: AdminActor, clientId: string, typedName: string): Promise<Outcome<{ catalogs: number }>> {
  const client = await adminClient(actor, clientId);
  if (!client) return { ok: false, error: actor.role === 'admin' ? 'not found' : 'forbidden' };
  if (client.isDefault) return { ok: false, error: 'default' };
  if (typedName.replace(/\s+/g, ' ').trim() !== client.name) return { ok: false, error: 'name mismatch' };

  const catalogs = await db.catalog.findMany({ where: { orgId: actor.orgId, clientId: client.id }, select: { id: true } });
  for (const c of catalogs) {
    const removed = await deleteCatalog(actor, c.id);
    if (!removed.ok) return { ok: false, error: 'not found' };
  }
  await db.$transaction([
    db.client.delete({ where: { id: client.id } }),
    event(actor, 'client.deleted', client.id, { name: client.name, catalogs: catalogs.length }),
  ]);
  return { ok: true, catalogs: catalogs.length };
}

export type AssignableAccountant = {
  id: string;
  email: string;
  assigned: boolean;
  /** No assignments at all: this person already sees every client. */
  unrestricted: boolean;
  /** This client is their only assignment: removing it would widen their access to every client. */
  onlyThis: boolean;
};

/** The org's accountants as the client's assignment editor shows them. */
export async function assignableAccountants(orgId: string, clientId: string): Promise<AssignableAccountant[]> {
  const people = await db.user.findMany({
    where: { orgId, role: 'accountant' },
    orderBy: { email: 'asc' },
    select: { id: true, email: true, assignments: { select: { clientId: true } } },
  });
  return people.map((p) => {
    const ids = p.assignments.map((a) => a.clientId);
    const assigned = ids.includes(clientId);
    return { id: p.id, email: p.email, assigned, unrestricted: ids.length === 0, onlyThis: assigned && ids.length === 1 };
  });
}

/**
 * Sets which scoped accountants work on this client. Never silently changes
 * anyone's reach: adding an unrestricted accountant would narrow them to this
 * one client, and removing someone's last client would widen them to all, so
 * both are refused here (Settings → Team handles them deliberately).
 */
export async function setClientAccountants(actor: AdminActor, clientId: string, userIds: string[]): Promise<Outcome<{ added: number; removed: number }>> {
  const client = await adminClient(actor, clientId);
  if (!client) return { ok: false, error: actor.role === 'admin' ? 'not found' : 'forbidden' };
  if (client.archivedAt) return { ok: false, error: 'archived' };
  const people = await assignableAccountants(actor.orgId, client.id);
  const byId = new Map(people.map((p) => [p.id, p]));
  const wanted = new Set(userIds);
  if ([...wanted].some((id) => !byId.has(id))) return { ok: false, error: 'bad user' };

  const add = people.filter((p) => wanted.has(p.id) && !p.assigned);
  const remove = people.filter((p) => !wanted.has(p.id) && p.assigned);
  if (add.some((p) => p.unrestricted)) return { ok: false, error: 'unrestricted' };
  if (remove.some((p) => p.onlyThis)) return { ok: false, error: 'last' };
  if (add.length === 0 && remove.length === 0) return { ok: true, added: 0, removed: 0 };

  await db.$transaction([
    db.clientAssignment.createMany({ data: add.map((p) => ({ userId: p.id, clientId: client.id })), skipDuplicates: true }),
    db.clientAssignment.deleteMany({ where: { clientId: client.id, userId: { in: remove.map((p) => p.id) } } }),
    event(actor, 'client.accountants_set', client.id, { added: add.map((p) => p.email), removed: remove.map((p) => p.email) }),
  ]);
  return { ok: true, added: add.length, removed: remove.length };
}

