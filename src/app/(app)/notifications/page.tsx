import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { listNotifications, unreadCount } from '@/lib/notifications';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconBell } from '@/ui/icons';
import { Page } from '@/ui/page';
import { MarkAllReadButton, MarkReadButton, NoticeLink } from './notice-actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.shellX.notices.title} — ${t.appName}` };
}

type SearchParams = { page?: string; show?: string };

const pageHref = (page: number, unreadOnly: boolean): string => {
  const q = new URLSearchParams();
  if (unreadOnly) q.set('show', 'unread');
  if (page > 1) q.set('page', String(page));
  const qs = q.toString();
  return qs ? `/notifications?${qs}` : '/notifications';
};

/** The user's notifications, newest first, paginated. Opening the page marks nothing read. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { locale, ta } = await getI18n();
  const n = ta.shellX.notices;
  const sp = await searchParams;
  const unreadOnly = sp.show === 'unread';
  const requested = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const [list, unread] = await Promise.all([listNotifications(user, { page: requested - 1, unreadOnly }), unreadCount(user)]);
  // Past the end (after marking things read, or an edited URL): show the last page that exists.
  if (requested > list.pageCount) redirect(pageHref(list.pageCount, unreadOnly));

  const from = list.total === 0 ? 0 : list.page * list.pageSize + 1;
  const to = list.page * list.pageSize + list.items.length;
  const num = (v: number): string => fmtNumber(locale, v);
  const tab = (active: boolean): string => cx(
    'inline-flex h-control-compact items-center gap-1.5 rounded-sm px-3 text-small font-medium',
    active ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
  );

  return (
    <Page title={n.title} hint={n.hint} wide actions={unread > 0 ? <MarkAllReadButton /> : null}>
      <nav aria-label={n.filter} className="mb-4 inline-flex rounded-ctl border border-line-strong bg-surface p-0.5">
        <Link href={pageHref(1, false)} aria-current={unreadOnly ? undefined : 'page'} className={tab(!unreadOnly)}>{n.all}</Link>
        <Link href={pageHref(1, true)} aria-current={unreadOnly ? 'page' : undefined} className={tab(unreadOnly)}>
          {n.unreadOnly}
          {unread > 0 ? <Badge tone="brand">{num(unread)}</Badge> : null}
        </Link>
      </nav>

      {list.items.length === 0 ? (
        unreadOnly ? (
          <EmptyState icon={<IconBell size={22} />} title={n.emptyUnread} action={<ButtonLink href={pageHref(1, false)}>{n.showAll}</ButtonLink>} />
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
                  <time dateTime={item.createdAt.toISOString()} className="shrink-0 text-micro text-muted">{fmtDateTime(locale, item.createdAt)}</time>
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
            {list.page > 0 ? <ButtonLink href={pageHref(list.page, unreadOnly)} size="sm">{n.prev}</ButtonLink> : null}
            {list.page + 1 < list.pageCount ? <ButtonLink href={pageHref(list.page + 2, unreadOnly)} size="sm">{n.next}</ButtonLink> : null}
          </div>
        </nav>
      ) : null}
    </Page>
  );
}
