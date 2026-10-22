import { canWrite, isAdminRole } from '@/lib/access';
import { getI18n } from '@/lib/locale';
import { localDate } from '@/lib/reminder-dates';
import { assignableMembers, reviewsFor } from '@/lib/review-assignments';
import type { CurrentUser } from '@/lib/session';
import { ReviewControl, type ReviewState } from './review-control';

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** One header row: the catalogue's review task for a ready catalogue; the viewer sees only what their scope allows. */
export async function ReviewField({ user, catalogId, clientId, demo }: { user: CurrentUser; catalogId: string; clientId: string; demo: boolean }) {
  const { ta } = await getI18n();
  const writes = canWrite(user) && !demo;
  const [seen, members] = await Promise.all([
    reviewsFor(user, [catalogId]),
    writes ? assignableMembers(user, clientId) : Promise.resolve([]),
  ]);
  const found = seen.get(catalogId);
  const review: ReviewState | null = found
    ? {
      assigneeId: found.assigneeId, assigneeEmail: found.assigneeEmail, dueOn: found.dueOn ? ymd(found.dueOn) : null, note: found.note,
      status: found.status, overdue: found.overdue, doneAt: found.doneAt ? found.doneAt.toISOString() : null,
    }
    : null;
  // A reader with nothing assigned has nothing to see.
  if (!review && !writes) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <dt className="text-muted">{ta.review.field}:</dt>
      <dd className="min-w-0">
        <ReviewControl
          catalogId={catalogId}
          review={review}
          members={members}
          canAssign={writes}
          canFinish={writes && Boolean(found) && (isAdminRole(user) || found?.assigneeId === user.userId)}
          today={ymd(localDate(new Date()).date)}
        />
      </dd>
    </div>
  );
}
