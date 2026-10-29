// The e-mail of each member id, also for people removed from the team since: decisions and finished
// reviews keep the user id, and the removal's audit event (team-members.ts) keeps the address.
import { db } from '@tasnivo/db';

export async function memberEmails(orgId: string, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await db.user.findMany({ where: { orgId, id: { in: wanted } }, select: { id: true, email: true } });
  const found = new Map(users.map((u) => [u.id, u.email]));
  const gone = wanted.filter((id) => !found.has(id));
  if (gone.length === 0) return found;
  const removals = await db.auditEvent.findMany({ where: { orgId, action: 'team.removed', targetId: { in: gone } }, select: { targetId: true, payload: true } });
  for (const r of removals) {
    const email = typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>)['email'] : null;
    if (r.targetId && typeof email === 'string') found.set(r.targetId, email);
  }
  return found;
}
