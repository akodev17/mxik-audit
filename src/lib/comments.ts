// Row notes and the "Mijozdan soʻrash" / "Hal qilindi" flags. Internal only:
// nothing here reaches share links, PDFs or exports.
import { catalogScope } from './access';
import { db } from './db';
import { mayWrite, type RoleCarrier } from './write-access';

type Scope = { orgId: string; userId: string; clientIds?: string[] | null } & RoleCarrier;

export type CommentView = { id: string; author: string | null; body: string; at: string };

const MAX_LENGTH = 2000;

async function visibleFinding(scope: Pick<Scope, 'orgId' | 'clientIds'>, findingId: string) {
  return db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(scope) } },
    select: { id: true, flag: true, item: { select: { catalogId: true } } },
  });
}

export async function listComments(scope: Pick<Scope, 'orgId' | 'clientIds'>, findingId: string): Promise<CommentView[]> {
  if (!(await visibleFinding(scope, findingId))) return [];
  const rows = await db.findingComment.findMany({ where: { findingId, orgId: scope.orgId }, orderBy: { createdAt: 'asc' }, take: 200 });
  const users = await db.user.findMany({ where: { id: { in: rows.flatMap((r) => (r.userId ? [r.userId] : [])) }, orgId: scope.orgId }, select: { id: true, email: true } });
  const email = new Map(users.map((u) => [u.id, u.email]));
  return rows.map((r) => ({ id: r.id, author: r.userId ? email.get(r.userId) ?? null : null, body: r.body, at: r.createdAt.toISOString() }));
}

export async function addComment(scope: Scope, findingId: string, body: string): Promise<boolean> {
  if (!mayWrite(scope)) return false;
  const text = body.trim().slice(0, MAX_LENGTH);
  const finding = await visibleFinding(scope, findingId);
  if (!finding || text.length === 0) return false;
  await db.findingComment.create({ data: { orgId: scope.orgId, findingId, userId: scope.userId, body: text } });
  await db.auditEvent.create({ data: { orgId: scope.orgId, actorId: scope.userId, action: 'finding.commented', targetId: findingId, payload: { catalogId: finding.item.catalogId } } });
  return true;
}

export type Flag = 'ask_client' | 'resolved' | null;

export async function setFlag(scope: Scope, findingId: string, flag: Flag): Promise<boolean> {
  if (!mayWrite(scope)) return false;
  const finding = await visibleFinding(scope, findingId);
  if (!finding) return false;
  await db.$transaction([
    db.finding.update({ where: { id: finding.id }, data: { flag }, select: { id: true } }),
    db.auditEvent.create({
      data: {
        orgId: scope.orgId, actorId: scope.userId, action: 'finding.flagged', targetId: findingId,
        payload: { catalogId: finding.item.catalogId, flag, count: 1, findings: [{ id: finding.id, previous: finding.flag }] },
      },
    }),
  ]);
  return true;
}

/** Comment counts for a page of findings. */
export async function commentCounts(findingIds: readonly string[]): Promise<Map<string, number>> {
  if (findingIds.length === 0) return new Map();
  const rows = await db.findingComment.groupBy({ by: ['findingId'], where: { findingId: { in: [...findingIds] } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.findingId, r._count._all]));
}
