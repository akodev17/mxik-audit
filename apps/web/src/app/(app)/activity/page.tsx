import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ACTIVITY_CATEGORIES } from '@tasnivo/contracts/modules/account';
import { fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { groupDecisions } from '@/lib/pure/activity-groups';
import { withQuery } from '@/lib/pure/query-string';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { ActivityFilters } from './activity-filters';
import { ActivityTable } from './activity-table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.log.title} — ${t.appName}` };
}

type Params = { client?: string; user?: string; type?: string; from?: string; to?: string; page?: string };

/** A typed day longer than the API takes cannot be a day: it is sent as one the API reports unreadable. */
const typedDay = (value: string | undefined): string | undefined => (value === undefined ? undefined : value.trim().length > 10 ? '?' : value);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
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
  const firstShown = (page - 1) * result.pageSize + 1;
  const lastShown = (page - 1) * result.pageSize + result.rows.length;
  const params: Record<string, string | undefined> = { client: clientId ?? undefined, user: userId ?? undefined, type: category === 'all' ? undefined : category, from: from || undefined, to: to || undefined };
  const active = Object.values(params).some(Boolean);
  // A page past the end (an old link, or rows deleted since) goes to the last page, not to an empty one.
  if (result.rows.length === 0 && page > 1 && total > 0) redirect(withQuery('/activity', params, { page: pages > 1 ? String(pages) : null }));
  const fmt = (n: number): string => fmtNumber(locale, n);

  return (
    <Page title={ta.log.title} hint={ta.firmX.log.hint} wide>
      <ActivityFilters clients={clients} users={users} value={{ clientId, userId, category, from, to }} active={active} />
      {unreadable ? <p role="status" className="-mt-2 mb-4 text-small text-warn-ink">{ta.firmX.log.badDate}</p> : null}
      {swapped ? <p role="status" className="-mt-2 mb-4 text-small text-warn-ink">{ta.firmX.log.badRange}</p> : null}

      {result.rows.length === 0 ? (
        active ? (
          <EmptyState
            title={ta.log.empty} hint={ta.log.emptyHint}
            action={<ButtonLink href="/activity" variant="secondary">{ta.firmX.log.reset}</ButtonLink>}
          />
        ) : <EmptyState title={ta.firmX.log.emptyAll} hint={ta.firmX.log.emptyAllHint} />
      ) : (
        <>
          <ActivityTable entries={groupDecisions(result.rows.map((r) => ({ ...r, at: new Date(r.at) })))} />
          <nav aria-label={ta.log.title} className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-small text-muted">
              {ta.firmX.log.page(page)} · {ta.firmX.log.range(fmt(firstShown), fmt(lastShown), fmt(total))}
            </span>
            <span className="flex gap-2">
              {page > 1 ? <ButtonLink href={withQuery('/activity', params, { page: page - 1 > 1 ? String(page - 1) : null })} size="sm" variant="secondary">← {ta.log.newer}</ButtonLink> : null}
              {result.hasMore && page < pages ? <ButtonLink href={withQuery('/activity', params, { page: String(page + 1) })} size="sm" variant="secondary">{ta.log.older} →</ButtonLink> : null}
            </span>
          </nav>
        </>
      )}
    </Page>
  );
}
