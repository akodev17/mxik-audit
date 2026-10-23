import Link from 'next/link';
import { fmtDate } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { nameInitials } from '@/ui/shell/initials';
import { Card } from './card';
import type { OpenReview, ReviewCounts } from './dashboard-data';

/**
 * Catalogue reviews handed to the team and not yet closed: overdue first, then by due date. Everyone
 * sees the ones in their client scope; "mine" narrows to the signed-in person's. Each row opens its catalogue.
 */
export async function ReviewTasks({ items, counts, mineOnly, viewHref }: {
  items: OpenReview[]; counts: ReviewCounts; mineOnly: boolean; viewHref: (mine: boolean) => string;
}) {
  const { ta, locale } = await getI18n();
  const r = ta.review.dash;
  return (
    <Card id="reviews" title={r.title} hint={counts.overdue > 0 ? `${r.hint} ${r.overdueCount(counts.overdue)}.` : r.hint} flush>
      <nav aria-label={r.title} className="flex items-center gap-1.5 px-4 pb-3 sm:px-5">
        {([[false, r.all, counts.open], [true, r.mine, counts.mine]] as const).map(([mine, label, n]) => (
          <Link
            key={String(mine)} href={viewHref(mine)} scroll={false} aria-current={mine === mineOnly ? 'true' : undefined}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
              mine === mineOnly ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {label} <span className={cx('tabular-nums', mine === mineOnly ? 'text-inverse' : 'text-subtle')}>{n}</span>
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="border-t border-line px-5 py-6 text-center text-small text-muted">{mineOnly ? r.emptyMine : r.empty}</p> : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((x) => (
            <li key={x.catalogId} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-sunken text-micro font-semibold text-muted">{nameInitials(x.clientName)}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/catalogs/${x.catalogId}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={`${x.clientName} · ${x.filename}`}>{x.clientName}</Link>
                <p className="truncate text-small text-muted" title={x.assigneeEmail}>{x.assigneeEmail}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-small text-muted">
                  {x.dueOn ? ta.review.dueOn(fmtDate(locale, x.dueOn)) : r.noDue}
                  {x.overdue ? <StatusChip tone="danger" icon={<StatusIcon tone="danger" size={12} />}>{ta.review.overdue}</StatusChip> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
