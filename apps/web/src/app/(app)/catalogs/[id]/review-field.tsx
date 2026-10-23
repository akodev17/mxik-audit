import { serverApi } from '@/lib/api/server';
import { canWrite, isAdminRole, localToday } from '@/lib/catalogs/report';
import type { Me } from '@/lib/catalogs/types';
import { getI18n } from '@/lib/locale';
import { ReviewControl } from './review-control';

/** One header row: the catalogue's review task for a ready catalogue; the viewer sees only what their scope allows. */
export async function ReviewField({ user, catalogId, demo }: { user: Me; catalogId: string; demo: boolean }) {
  const { ta } = await getI18n();
  const writes = canWrite(user) && !demo;
  // The task and, for a writer outside a demo, the members it can be given to.
  const initial = await serverApi().catalogs.review({ catalogId });
  // A reader with nothing assigned has nothing to see.
  if (!initial.review && !writes) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <dt className="text-muted">{ta.review.field}:</dt>
      <dd className="min-w-0">
        <ReviewControl
          catalogId={catalogId}
          initial={initial}
          canAssign={writes}
          finisher={{ userId: user.userId, admin: isAdminRole(user) }}
          today={localToday(new Date())}
        />
      </dd>
    </div>
  );
}
