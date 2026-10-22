'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconBell } from '@/ui/icons';
import { MarkReadButton, NoticeLink } from './notice-actions';
import { NOTICE_GROUPS, pageHref } from './notice-href';
import { useNotices, type NoticePage, type NoticeParams } from './notice-query';

const tab = (active: boolean): string => cx(
  'inline-flex h-control-compact items-center gap-1.5 rounded-sm px-3 text-small font-medium',
  active ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
);

/** Filters, the notices of one page and the pager. Opening the page marks nothing read. */
export function NoticeList({ params, initial }: { params: NoticeParams; initial: NoticePage }) {
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

  return (
    <>
      <nav aria-label={n.filter} className="mb-4 inline-flex rounded-ctl border border-line-strong bg-surface p-0.5">
        <Link href={pageHref(1, false, topic)} aria-current={unreadOnly ? undefined : 'page'} className={tab(!unreadOnly)}>{n.all}</Link>
        <Link href={pageHref(1, true, topic)} aria-current={unreadOnly ? 'page' : undefined} className={tab(unreadOnly)}>
          {n.unreadOnly}
          {unread > 0 ? <Badge tone="brand">{num(unread)}</Badge> : null}
        </Link>
      </nav>
      <nav aria-label={n.topic} className="mb-4 ml-0 flex flex-wrap items-center gap-1 text-small sm:ml-3 sm:inline-flex">
        {[undefined, ...NOTICE_GROUPS].map((g) => (
          <Link key={g ?? 'all'} href={pageHref(1, unreadOnly, g)} aria-current={g === topic ? 'true' : undefined} className={cx('rounded-ctl px-2.5 py-1 font-medium', g === topic ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}>
            {g ? n.groups[g] : n.all}
          </Link>
        ))}
      </nav>

      {list.items.length === 0 ? (
        unreadOnly ? (
          <EmptyState icon={<IconBell size={22} />} title={n.emptyUnread} action={<ButtonLink href={pageHref(1, false, topic)}>{n.showAll}</ButtonLink>} />
        ) : (
          <EmptyState icon={<IconBell size={22} />} title={n.emptyAll} hint={n.emptyAllHint} />
        )
      ) : (
        <ol className="divide-y divide-line rounded-md border border-line bg-raised">
          {list.items.map((item) => (
            <li key={item.id} className="relative flex gap-3 px-4 py-3">
              <span aria-hidden className={cx('mt-2 size-2 shrink-0 rounded-full', item.unread ? 'bg-brand' : 'bg-transparent')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className={cx('min-w-0 break-words text-data', item.unread ? 'font-semibold' : 'font-medium')}>{item.title}</h2>
                  <time dateTime={item.createdAt} className="shrink-0 text-micro text-muted">{fmtDateTime(locale, item.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-line break-words text-small text-muted">{item.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
                  {item.unread ? <Badge tone="brand">{ta.shellX.bell.unread}</Badge> : <span className="text-micro text-subtle">{n.read}</span>}
                  {item.client ? (
                    <Link href={`/clients/${item.client.id}`} className="text-muted hover:text-brand-ink hover:underline">{item.client.name}</Link>
                  ) : (
                    <span className="text-muted">{ta.shellX.bell.general}</span>
                  )}
                  {item.href ? (
                    <NoticeLink id={item.id} href={item.href} unread={item.unread} className="font-medium text-brand-ink hover:underline">{n.open}</NoticeLink>
                  ) : null}
                  {item.unread ? <MarkReadButton id={item.id} /> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {list.total > list.pageSize ? (
        <nav aria-label={n.pages} className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-muted">{n.range(num(from), num(to), num(list.total))}</p>
          <div className="flex gap-2">
            {list.page > 0 ? <ButtonLink href={pageHref(list.page, unreadOnly, topic)} size="sm">{n.prev}</ButtonLink> : null}
            {list.page + 1 < list.pageCount ? <ButtonLink href={pageHref(list.page + 2, unreadOnly, topic)} size="sm">{n.next}</ButtonLink> : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
