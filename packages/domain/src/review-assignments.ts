// Review tasks: a ready catalogue is handed to one team member with a due date and a note, and
// closed by that person (or an admin). One task per catalogue; changing it bumps the revision,
// which keeps each notification single. Authorization lives here, behind the action guards.
import { Prisma } from '@prisma/client';
import { canSeeClient } from './access.js';
import { db } from '@tasnivo/db';
import { orgLocale } from './org-locale.js';
import { inEveryLocale, reviewAssignedText, reviewCompletedText } from './notification-text.js';
import { notify } from './notifications.js';
import { localDate } from './reminder-dates.js';
import { mayWrite, type RoleCarrier } from './write-access.js';

type Who = { userId: string; orgId: string; clientIds?: string[] | null } & RoleCarrier;

export const NOTE_MAX = 500;

export type ReviewError = 'not found' | 'not ready' | 'bad assignee' | 'assignee scope' | 'bad due' | 'due past' | 'bad note' | 'already done' | 'forbidden';

export type AssignInput = { catalogId: string; assigneeId: string; dueOn: string | null; note: string | null };

/** A date typed as YYYY-MM-DD, or null when it is not a real calendar day. */
export function parseDueDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export type ReviewView = {
  id: string;
  catalogId: string;
  assigneeId: string;
  assigneeEmail: string;
  dueOn: Date | null;
  note: string | null;
  status: 'open' | 'done';
  overdue: boolean;
  doneAt: Date | null;
};

const viewSelect = {
  id: true, catalogId: true, assigneeId: true, dueOn: true, note: true, status: true, doneAt: true,
  assignee: { select: { email: true } },
} satisfies Prisma.ReviewAssignmentSelect;

type Row = Prisma.ReviewAssignmentGetPayload<{ select: typeof viewSelect }>;

function toView(r: Row, now: Date): ReviewView {
  return {
    id: r.id, catalogId: r.catalogId, assigneeId: r.assigneeId, assigneeEmail: r.assignee.email, dueOn: r.dueOn, note: r.note,
    status: r.status, doneAt: r.doneAt,
    overdue: r.status === 'open' && r.dueOn !== null && r.dueOn < localDate(now).date,
  };
}

/** Same rule as session.ts: admins and members with no assignments see every client. */
function scopeOf(u: { role: string; assignments: { clientId: string }[] }): string[] | null {
  return u.role !== 'admin' && u.assignments.length > 0 ? u.assignments.map((a) => a.clientId) : null;
}

export type Assignable = { id: string; email: string };

/** Members who could take a review of this client: not viewers, and able to open the client. */
export async function assignableMembers(who: Who, clientId: string): Promise<Assignable[]> {
  if (!canSeeClient(who, clientId)) return [];
  const members = await db.user.findMany({
    where: { orgId: who.orgId, role: { not: 'viewer' } }, orderBy: { email: 'asc' },
    select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } },
  });
  return members.filter((m) => canSeeClient({ clientIds: scopeOf(m) }, clientId)).map((m) => ({ id: m.id, email: m.email }));
}

/** The task of each of these catalogues the user may see; the caller passes only catalogues already in scope. */
export async function reviewsFor(who: Who, catalogIds: readonly string[], now = new Date()): Promise<Map<string, ReviewView>> {
  if (catalogIds.length === 0) return new Map();
  const rows = await db.reviewAssignment.findMany({
    where: { orgId: who.orgId, catalogId: { in: [...catalogIds] }, ...(who.clientIds ? { clientId: { in: who.clientIds } } : {}) },
    select: viewSelect,
  });
  return new Map(rows.map((r) => [r.catalogId, toView(r, now)]));
}

export type AssignResult = { ok: true; changed: boolean; id: string } | { ok: false; error: ReviewError };

/**
 * Hands a ready catalogue to a member, or updates the existing task (new person, date or note).
 * Nothing is written when nothing changed. A finished task assigned again is open again.
 */
export async function assignReview(who: Who, input: AssignInput, now = new Date()): Promise<AssignResult> {
  if (!mayWrite(who)) return { ok: false, error: 'not found' };
  const catalog = await db.catalog.findFirst({
    where: { id: input.catalogId, orgId: who.orgId }, select: { id: true, clientId: true, status: true, filename: true, client: { select: { name: true } } },
  });
  if (!catalog?.clientId || !canSeeClient(who, catalog.clientId)) return { ok: false, error: 'not found' };
  if (catalog.status !== 'ready') return { ok: false, error: 'not ready' };

  let dueOn: Date | null = null;
  if (input.dueOn) {
    dueOn = parseDueDate(input.dueOn);
    if (!dueOn) return { ok: false, error: 'bad due' };
    if (dueOn < localDate(now).date) return { ok: false, error: 'due past' };
  }
  const note = input.note?.trim() || null;
  if (note && [...note].length > NOTE_MAX) return { ok: false, error: 'bad note' };

  const assignee = await db.user.findFirst({
    where: { id: input.assigneeId, orgId: who.orgId, role: { not: 'viewer' } },
    select: { id: true, role: true, assignments: { select: { clientId: true } } },
  });
  if (!assignee) return { ok: false, error: 'bad assignee' };
  if (!canSeeClient({ clientIds: scopeOf(assignee) }, catalog.clientId)) return { ok: false, error: 'assignee scope' };

  const clientId = catalog.clientId;
  const write = async (): Promise<{ changed: boolean; id: string; revision: number }> => db.$transaction(async (tx) => {
    const current = await tx.reviewAssignment.findUnique({ where: { catalogId: catalog.id } });
    const same = current && current.status === 'open' && current.assigneeId === assignee.id && note === current.note
      && (current.dueOn?.getTime() ?? null) === (dueOn?.getTime() ?? null);
    if (current && same) return { changed: false, id: current.id, revision: current.revision };
    const data = { assigneeId: assignee.id, dueOn, note, status: 'open' as const, doneAt: null, doneBy: null, doneNote: null, createdBy: who.userId };
    const saved = current
      ? await tx.reviewAssignment.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 }, updatedAt: now } })
      : await tx.reviewAssignment.create({ data: { ...data, orgId: who.orgId, clientId, catalogId: catalog.id } });
    await tx.auditEvent.create({
      data: {
        orgId: who.orgId, actorId: who.userId, action: 'review.assigned', targetId: catalog.id,
        payload: { clientId, assigneeId: assignee.id, dueOn: dueOn?.toISOString().slice(0, 10) ?? null, reassigned: Boolean(current), revision: saved.revision },
      },
    });
    return { changed: true, id: saved.id, revision: saved.revision };
  });

  let saved;
  try {
    saved = await write();
  } catch (error) {
    // Two people handed out the same catalogue at once: the loser retries as an update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') saved = await write();
    else throw error;
  }
  if (saved.changed && assignee.id !== who.userId) {
    const locale = await orgLocale(who.orgId);
    const by = await db.user.findUnique({ where: { id: who.userId }, select: { email: true } });
    const text = inEveryLocale((l) => reviewAssignedText({ clientName: catalog.client?.name ?? '', filename: catalog.filename, dueOn, note, by: by?.email }, l));
    await notify({
      orgId: who.orgId, clientId, userId: assignee.id, kind: 'review.assigned', ...text[locale], text,
      href: `/catalogs/${catalog.id}`, dedupeKey: `review.assigned:${saved.id}:${saved.revision}`,
    });
  }
  return { ok: true, changed: saved.changed, id: saved.id };
}

export type CompleteResult = { ok: true } | { ok: false; error: ReviewError };

/** Closes a review. Only its assignee or an admin may; closing twice is refused, not repeated. */
export async function completeReview(who: Who, catalogId: string, doneNote: string | null, now = new Date()): Promise<CompleteResult> {
  if (!mayWrite(who)) return { ok: false, error: 'not found' };
  const task = await db.reviewAssignment.findFirst({
    where: { catalogId, orgId: who.orgId },
    select: { id: true, clientId: true, assigneeId: true, createdBy: true, status: true, revision: true, catalog: { select: { filename: true } }, client: { select: { name: true } } },
  });
  if (!task || !canSeeClient(who, task.clientId)) return { ok: false, error: 'not found' };
  if (who.role !== 'admin' && who.role !== undefined && task.assigneeId !== who.userId) return { ok: false, error: 'forbidden' };
  if (task.status === 'done') return { ok: false, error: 'already done' };
  const note = doneNote?.trim() || null;
  if (note && [...note].length > NOTE_MAX) return { ok: false, error: 'bad note' };

  const closed = await db.$transaction(async (tx) => {
    const res = await tx.reviewAssignment.updateMany({
      where: { id: task.id, status: 'open', revision: task.revision },
      data: { status: 'done', doneAt: now, doneBy: who.userId, doneNote: note, updatedAt: now },
    });
    if (res.count === 0) return false;
    await tx.auditEvent.create({
      data: { orgId: who.orgId, actorId: who.userId, action: 'review.completed', targetId: catalogId, payload: { clientId: task.clientId, assigneeId: task.assigneeId } },
    });
    return true;
  });
  if (!closed) return { ok: false, error: 'already done' };
  if (task.createdBy && task.createdBy !== who.userId) {
    const locale = await orgLocale(who.orgId);
    const by = await db.user.findUnique({ where: { id: who.userId }, select: { email: true } });
    const text = inEveryLocale((l) => reviewCompletedText({ clientName: task.client.name, filename: task.catalog.filename, note, by: by?.email }, l));
    await notify({
      orgId: who.orgId, clientId: task.clientId, userId: task.createdBy, kind: 'review.completed', ...text[locale], text,
      href: `/catalogs/${catalogId}`, dedupeKey: `review.completed:${task.id}:${task.revision}`,
    });
  }
  return { ok: true };
}

export type ReviewCounts = { open: number; overdue: number; mine: number };

/** Open reviews the user may see, how many are overdue and how many are theirs. */
export async function reviewCounts(who: Who, now = new Date()): Promise<ReviewCounts> {
  const scope: Prisma.ReviewAssignmentWhereInput = { orgId: who.orgId, status: 'open', ...(who.clientIds ? { clientId: { in: who.clientIds } } : {}) };
  const today = localDate(now).date;
  const [open, overdue, mine] = await Promise.all([
    db.reviewAssignment.count({ where: scope }),
    db.reviewAssignment.count({ where: { ...scope, dueOn: { lt: today } } }),
    db.reviewAssignment.count({ where: { ...scope, assigneeId: who.userId } }),
  ]);
  return { open, overdue, mine };
}

export type OpenReview = {
  catalogId: string;
  clientId: string;
  clientName: string;
  filename: string;
  assigneeId: string;
  assigneeEmail: string;
  dueOn: Date | null;
  overdue: boolean;
  mine: boolean;
};

/** Open reviews for the dashboard, overdue first, then by due date (undated last); at most `limit`. */
export async function openReviews(who: Who, opts: { mineOnly?: boolean; limit?: number } = {}, now = new Date()): Promise<OpenReview[]> {
  const today = localDate(now).date;
  const rows = await db.reviewAssignment.findMany({
    where: { orgId: who.orgId, status: 'open', ...(who.clientIds ? { clientId: { in: who.clientIds } } : {}), ...(opts.mineOnly ? { assigneeId: who.userId } : {}) },
    select: {
      catalogId: true, clientId: true, assigneeId: true, dueOn: true, updatedAt: true,
      assignee: { select: { email: true } }, client: { select: { name: true } }, catalog: { select: { filename: true } },
    },
    take: 200,
  });
  const key = (d: Date | null): number => d?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return rows
    .map((r): OpenReview & { at: number } => ({
      catalogId: r.catalogId, clientId: r.clientId, clientName: r.client.name, filename: r.catalog.filename,
      assigneeId: r.assigneeId, assigneeEmail: r.assignee.email, dueOn: r.dueOn,
      overdue: r.dueOn !== null && r.dueOn < today, mine: r.assigneeId === who.userId, at: r.updatedAt.getTime(),
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || key(a.dueOn) - key(b.dueOn) || b.at - a.at)
    .slice(0, opts.limit ?? 8)
    .map(({ at: _at, ...rest }) => rest);
}
