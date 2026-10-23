import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ACTIVITY_CATEGORIES } from '@tasnivo/contracts/modules/account';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@/lib/pure/query-string';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconList } from '@/ui/icons';
import { Page } from '@/ui/page';
import { ActivityFilters } from './activity-filters';
import { ActivityTimeline, type ActivityQuery } from './activity-timeline';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.log.title} — ${t.appName}` };
}

type Params = { client?: string; user?: string; type?: string; from?: string; to?: string; page?: string };

/** A typed day longer than the API takes cannot be a day: it is sent as one the API reports unreadable. */
const typedDay = (value: string | undefined): string | undefined => (value === undefined ? undefined : value.trim().length > 10 ? '?' : value);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { ta } = await getI18n();
  const sp = await searchParams;
  const type = ACTIVITY_CATEGORIES.find((c) => c === sp.type);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  // Days are typed as dd.mm.yyyy (older links: yyyy-mm-dd). The API drops unreadable ones and swaps a
  // reversed range, and says so; a client or member outside the viewer's reach is ignored.
  const result = await pageData(serverApi().account.activity({
    ...(sp.client ? { client: sp.client } : {}),
    ...(sp.user ? { user: sp.user } : {}),
    ...(type ? { category: type } : {}),
    ...(sp.from ? { from: typedDay(sp.from) } : {}),
    ...(sp.to ? { to: typedDay(sp.to) } : {}),
    page: page - 1,
  }));
  const { clients, users, unreadable, swapped } = result;
  const { clientId, userId, category } = result.applied;
  const from = result.applied.from ?? '';
  const to = result.applied.to ?? '';
  const total = result.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / result.pageSize));
  const params: Record<string, string | undefined> = { client: clientId ?? undefined, user: userId ?? undefined, type: category === 'all' ? undefined : category, from: from || undefined, to: to || undefined };
  const active = Object.values(params).some(Boolean);
  // A page past the end (an old link, or rows deleted since) goes to the last page, not to an empty one.
  if (result.rows.length === 0 && page > 1 && total > 0) redirect(withQuery('/activity', params, { page: pages > 1 ? String(pages) : null }));
  // "Show more" asks the API with the filters as applied (days already read, out-of-reach ids dropped).
  const query: ActivityQuery = {
    ...(clientId ? { client: clientId } : {}),
    ...(userId ? { user: userId } : {}),
    ...(category !== 'all' ? { category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  return (
    <Page title={ta.log.title} hint={ta.firmX.log.hint} wide>
      <ActivityFilters clients={clients} users={users} value={{ clientId, userId, category, from, to }} params={params} />
      {unreadable ? <p role="status" className="-mt-3 mb-4 text-small text-warn-ink">{ta.firmX.log.badDate}</p> : null}
      {swapped ? <p role="status" className="-mt-3 mb-4 text-small text-warn-ink">{ta.firmX.log.badRange}</p> : null}

      {result.rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-raised">
          {active ? (
            <EmptyState
              icon={<IconList size={22} />} title={ta.log.empty} hint={ta.log.emptyHint}
              action={<ButtonLink href="/activity" variant="secondary">{ta.firmX.log.reset}</ButtonLink>}
            />
          ) : <EmptyState icon={<IconList size={22} />} title={ta.firmX.log.emptyAll} hint={ta.firmX.log.emptyAllHint} />}
        </div>
      ) : (
        <ActivityTimeline
          key={JSON.stringify([query, page])}
          query={query}
          first={{ rows: result.rows, hasMore: result.hasMore, total, pageSize: result.pageSize, page }}
          now={Date.now()}
        />
      )}
    </Page>
  );
}
