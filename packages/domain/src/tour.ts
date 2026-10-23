// The guided product tour's flag (User.tourCompletedAt): read by the app frame (GET /api/shell),
// written by PUT /api/account/tour. Kept in the database so it follows the person across browsers.
import { db } from '@tasnivo/db';
import type { CurrentUser } from './session';

export type TourState = 'pending' | 'done';

type Who = Pick<CurrentUser, 'userId' | 'orgId' | 'demo'>;

/** 'pending' until the user finished or skipped the tour; a demo (session or org) never gets it. */
export async function tourState(user: Who): Promise<TourState> {
  if (user.demo) return 'done';
  const row = await db.user.findFirst({ where: { id: user.userId, orgId: user.orgId }, select: { tourCompletedAt: true, org: { select: { kind: true } } } });
  return row && row.tourCompletedAt === null && row.org.kind !== 'demo' ? 'pending' : 'done';
}

/**
 * `done` stamps now; `false` clears the flag (tests and support only: re-opening the tour from the
 * menu does not clear it). A demo is accepted and left alone, as its org is purged anyway.
 */
export async function setTourDone(user: Who, done: boolean): Promise<void> {
  if (user.demo) return;
  await db.user.updateMany({
    where: { id: user.userId, orgId: user.orgId, org: { kind: { not: 'demo' } } },
    data: { tourCompletedAt: done ? new Date() : null },
  });
}
