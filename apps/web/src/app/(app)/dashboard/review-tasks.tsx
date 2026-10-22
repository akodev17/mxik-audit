import Link from 'next/link';
import { fmtDate } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import type { OpenReview, ReviewCounts } from '@tasnivo/domain/review-assignments';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';

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
    <section aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="text-[1.125rem] font-medium leading-6">{r.title}</h2>
      <p className="mt-0.5 text-small text-muted">{r.hint}{counts.overdue > 0 ? ` ${r.overdueCount(counts.overdue)}.` : ''}</p>
      <nav aria-label={r.title} className="mt-3 flex items-center gap-1 text-small">
        {([[false, r.all, counts.open], [true, r.mine, counts.mine]] as const).map(([mine, label, n]) => (
          <Link
            key={String(mine)} href={viewHref(mine)} scroll={false} aria-current={mine === mineOnly ? 'true' : undefined}
            className={cx('rounded-ctl px-2.5 py-1 font-medium transition-colors duration-(--duration-fast)', mine === mineOnly ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}
          >
            {label} <span className="tabular-nums text-subtle">{n}</span>
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="mt-3 text-small text-muted">{mineOnly ? r.emptyMine : r.empty}</p> : (
        <ul className="mt-3 divide-y divide-line rounded-ctl border border-line bg-raised">
          {items.map((x) => (
            <li key={x.catalogId} className="px-4 py-2.5">
              <Link href={`/catalogs/${x.catalogId}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={`${x.clientName} · ${x.filename}`}>{x.clientName}</Link>
              <p className="truncate text-small text-muted" title={x.assigneeEmail}>{x.assigneeEmail}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-muted">
                {x.dueOn ? ta.review.dueOn(fmtDate(locale, x.dueOn)) : r.noDue}
                {x.overdue ? <StatusChip tone="danger" icon={<StatusIcon tone="danger" size={12} />}>{ta.review.overdue}</StatusChip> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
