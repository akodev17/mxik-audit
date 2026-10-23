'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { fmtDate, fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconBell, IconChevron } from '@/ui/icons';
import { groupByDay, timeOfDay } from '@/ui/shell/day-groups';
import { NoticeMark } from '@/ui/shell/notice-kind';
import { MarkReadButton, NoticeLink } from './notice-actions';
import { NOTICE_GROUPS, pageHref } from './notice-href';
import { useNotices, type NoticePage, type NoticeParams } from './notice-query';

const segment = (active: boolean): string => cx(
  'inline-flex h-control-compact items-center gap-1.5 rounded-sm px-3 text-small font-medium transition-colors duration-(--duration-fast)',
  active ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
);
const chip = (active: boolean): string => cx(
  'inline-flex h-7 items-center rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
  active ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
);

/**
 * Filters, the notices of one page grouped by day (today, yesterday, then dates), and the pager.
 * Unread notices are bold with a dot and can be marked read in place; opening the page marks nothing read.
 * `now` comes from the server render, so the day names are the same in the browser.
 */
export function NoticeList({ params, initial, now }: { params: NoticeParams; initial: NoticePage; now: number }) {
  const { locale, ta } = useI18n();
  const n = ta.shellX.notices;
  const router = useRouter();
  const list = useNotices(params, initial);
  const { unreadOnly, topic } = params;
  const { unread } = list;
  // Past the end after marking notices read (unread only): the last page that exists, as the server does.
  useEffect(() => {
    if (params.page > list.pageCount) router.replace(pageHref(list.pageCount, unreadOnly, topic));
  }, [params.page, list.pageCount, unreadOnly, topic, router]);

  const from = list.total === 0 ? 0 : list.page * list.pageSize + 1;
  const to = list.page * list.pageSize + list.items.length;
  const num = (v: number): string => fmtNumber(locale, v);
  const days = groupByDay(list.items, (item) => item.createdAt, now);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label={n.filter} className="inline-flex rounded-ctl border border-line bg-surface p-0.5">
          <Link href={pageHref(1, false, topic)} aria-current={unreadOnly ? undefined : 'page'} className={segment(!unreadOnly)}>{n.all}</Link>
          <Link href={pageHref(1, true, topic)} aria-current={unreadOnly ? 'page' : undefined} className={segment(unreadOnly)}>
            {n.unreadOnly}
            {unread > 0 ? <span className="rounded-full bg-brand px-1.5 text-micro font-semibold tabular-nums text-on-fill">{num(unread)}</span> : null}
          </Link>
        </nav>
        <nav aria-label={n.topic} className="flex flex-wrap items-center gap-1.5">
          {[undefined, ...NOTICE_GROUPS].map((g) => (
            <Link key={g ?? 'all'} href={pageHref(1, unreadOnly, g)} aria-current={g === topic ? 'true' : undefined} className={chip(g === topic)}>
              {g ? n.groups[g] : n.all}
            </Link>
          ))}
        </nav>
      </div>

      {list.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-raised">
          {unreadOnly ? (
            <EmptyState icon={<IconBell size={22} />} title={n.emptyUnread} action={<ButtonLink href={pageHref(1, false, topic)}>{n.showAll}</ButtonLink>} />
          ) : (
            <EmptyState icon={<IconBell size={22} />} title={n.emptyAll} hint={n.emptyAllHint} />
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((d) => (
            <section key={d.day} aria-labelledby={`day-${d.day}`}>
              <h2 id={`day-${d.day}`} className="mb-2 flex items-baseline gap-2 px-1 text-small font-semibold text-muted">
                {d.name === 'today' ? n.today : d.name === 'yesterday' ? n.yesterday : fmtDate(locale, d.items[0]?.createdAt ?? now)}
                {d.name ? <span className="font-normal text-subtle">{fmtDate(locale, d.items[0]?.createdAt ?? now)}</span> : null}
              </h2>
              <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
                {d.items.map((item) => (
                  <li key={item.id} className={cx('relative flex gap-3.5 px-4 py-3.5 sm:px-5', item.unread && 'bg-brand-tint/30')}>
                    <NoticeMark kind={item.kind} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                        <h3 className={cx('min-w-0 break-words text-data', item.unread ? 'font-semibold text-fg' : 'font-medium text-fg')}>
                          {item.unread ? <span className="sr-only">{ta.shellX.bell.unread}: </span> : null}
                          {item.title}
                        </h3>
                        <time dateTime={item.createdAt} className="shrink-0 text-micro tabular-nums text-muted" title={fmtDateTime(locale, item.createdAt)}>
                          {timeOfDay(fmtDateTime(locale, item.createdAt))}
                        </time>
                      </div>
                      {item.body ? <p className="mt-1 whitespace-pre-line break-words text-small text-muted">{item.body}</p> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small">
                        {item.client ? (
                          <Link href={`/clients/${item.client.id}`} className="text-muted hover:text-brand-ink hover:underline">{item.client.name}</Link>
                        ) : (
                          <span className="text-muted">{ta.shellX.bell.general}</span>
                        )}
                        {!item.unread ? <span className="text-micro text-subtle">· {n.read}</span> : null}
                        <span className="ml-auto flex items-center gap-1">
                          {item.unread ? <MarkReadButton id={item.id} /> : null}
                          {item.href ? (
                            <NoticeLink id={item.id} href={item.href} unread={item.unread} className="inline-flex h-control-inline items-center gap-1 rounded-ctl px-2 font-medium text-brand-ink hover:bg-brand-tint">
                              {n.open}<IconChevron size={12} />
                            </NoticeLink>
                          ) : null}
                        </span>
                      </div>
                    </div>
                    {item.unread ? <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-brand sm:right-2.5 sm:top-2.5" /> : null}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {list.total > list.pageSize ? (
        <nav aria-label={n.pages} className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-small tabular-nums text-muted">{n.range(num(from), num(to), num(list.total))}</p>
          <div className="flex gap-2">
            {list.page > 0 ? <ButtonLink href={pageHref(list.page, unreadOnly, topic)} size="sm">{n.prev}</ButtonLink> : null}
            {list.page + 1 < list.pageCount ? <ButtonLink href={pageHref(list.page + 2, unreadOnly, topic)} size="sm">{n.next}</ButtonLink> : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
