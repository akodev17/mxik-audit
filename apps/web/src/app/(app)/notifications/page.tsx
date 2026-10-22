import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { requireMe } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { Page } from '@/ui/page';
import { MarkAllReadButton } from './notice-actions';
import { NOTICE_GROUPS, pageHref } from './notice-href';
import { NoticeList } from './notice-list';
import type { NoticeParams } from './notice-query';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.shellX.notices.title} — ${t.appName}` };
}

type SearchParams = { page?: string; show?: string; topic?: string };

/** The user's notifications, newest first, paginated. Opening the page marks nothing read. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ta } = await getI18n();
  const n = ta.shellX.notices;
  const sp = await searchParams;
  const unreadOnly = sp.show === 'unread';
  const topic = NOTICE_GROUPS.find((g) => g === sp.topic);
  const requested = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const listing = serverApi().notifications.list({ page: requested - 1, ...(unreadOnly ? { unread: '1' as const } : {}), ...(topic ? { group: topic } : {}) });
  listing.catch(() => undefined); // awaited below, after a missing session has redirected
  await requireMe();
  const list = await listing;
  // Past the end (after marking things read, or an edited URL): show the last page that exists.
  if (requested > list.pageCount) redirect(pageHref(list.pageCount, unreadOnly, topic));
  const params: NoticeParams = { page: requested, unreadOnly, topic };

  return (
    <Page title={n.title} hint={n.hint} wide actions={list.unread > 0 ? <MarkAllReadButton params={params} initial={list} /> : null}>
      <NoticeList key={`${requested}|${unreadOnly}|${topic ?? ''}`} params={params} initial={list} />
    </Page>
  );
}
