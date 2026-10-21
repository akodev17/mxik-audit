// Client access as an explicit choice, and what a change would widen. Pure; the server re-checks everything.
import type { Role } from '@/lib/session';

export type ClientAccess = 'all' | 'selected';
export type AccessDraft = { role: Role; access: ClientAccess; clientIds: string[] };

const RANK: Record<Role, number> = { viewer: 0, accountant: 1, admin: 2 };

/** A member's current access as a draft: no assigned clients means all clients. */
export function draftOf(member: { role: Role; clientIds: readonly string[] }): AccessDraft {
  const selected = member.role !== 'admin' && member.clientIds.length > 0;
  return { role: member.role, access: selected ? 'selected' : 'all', clientIds: selected ? [...member.clientIds] : [] };
}

const seesAll = (d: AccessDraft): boolean => d.role === 'admin' || d.access === 'all';

/** "Selected clients" with none selected would silently mean every client, so it cannot be saved. */
export function draftError(d: AccessDraft): 'no_clients' | null {
  return !seesAll(d) && d.clientIds.length === 0 ? 'no_clients' : null;
}

export function sameAccess(a: AccessDraft, b: AccessDraft): boolean {
  if (a.role !== b.role || seesAll(a) !== seesAll(b)) return false;
  if (seesAll(a)) return true;
  return [...a.clientIds].sort().join() === [...b.clientIds].sort().join();
}

export type Widening = { role: Role | null; allClients: boolean; addedClients: string[] };

/** What the change grants beyond today: a higher role, every client, or more clients. Null when it grants nothing new. */
export function widening(before: AccessDraft, after: AccessDraft): Widening | null {
  const role = RANK[after.role] > RANK[before.role] ? after.role : null;
  const allClients = after.role !== 'admin' && !seesAll(before) && seesAll(after);
  const addedClients = seesAll(before) || seesAll(after) ? [] : after.clientIds.filter((id) => !before.clientIds.includes(id));
  return role || allClients || addedClients.length > 0 ? { role, allClients, addedClients } : null;
}

/** The only admin cannot give the role up: someone must be able to manage the org. */
export function lastAdminLocked(member: { role: Role }, adminCount: number): boolean {
  return member.role === 'admin' && adminCount <= 1;
}
