import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { clientScope } from '@/lib/access';
import { activityPage, CATEGORIES, tashkentDayStart, type Category } from '@/lib/activity';
import { groupDecisions } from '@/lib/activity-groups';
import { db } from '@/lib/db';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@/lib/query-string';
import { currentUser } from '@/lib/session';
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

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const category: Category = CATEGORIES.find((c) => c === sp.type) ?? 'all';
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  // Days that do not parse are dropped; a reversed range is swapped and said so.
  let from = tashkentDayStart(sp.from ?? null) ? sp.from ?? '' : '';
  let to = tashkentDayStart(sp.to ?? null) ? sp.to ?? '' : '';
  const swapped = Boolean(from && to && from > to);
  if (swapped) [from, to] = [to, from];

  const [clients, users] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId, ...clientScope(user) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { email: 'asc' }, select: { id: true, email: true } }),
  ]);
  // A client id outside the user's scope is ignored, never trusted.
  const clientId = clients.find((c) => c.id === sp.client)?.id ?? null;
  const userId = users.find((u) => u.id === sp.user)?.id ?? null;
  const result = await activityPage(
    user,
    { clientId, userId, category, from: from || null, to: to || null, page: page - 1 },
    { withTotal: true },
  );
  const total = result.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / result.pageSize));
  const firstShown = (page - 1) * result.pageSize + 1;
  const lastShown = (page - 1) * result.pageSize + result.rows.length;
  const params: Record<string, string | undefined> = { client: clientId ?? undefined, user: userId ?? undefined, type: category === 'all' ? undefined : category, from: from || undefined, to: to || undefined };
  const active = Object.values(params).some(Boolean);
  const fmt = (n: number): string => fmtNumber(locale, n);

  return (
    <Page title={ta.log.title} hint={ta.firmX.log.hint} wide>
      <ActivityFilters clients={clients} users={users} value={{ clientId, userId, category, from, to }} active={active} />
      {swapped ? <p role="status" className="-mt-2 mb-4 text-small text-warn-ink">{ta.firmX.log.badRange}</p> : null}

      {result.rows.length === 0 ? (
        <EmptyState
          title={ta.log.empty} hint={ta.log.emptyHint}
          action={active || page > 1 ? <ButtonLink href="/activity" variant="secondary">{ta.firmX.log.reset}</ButtonLink> : null}
        />
      ) : (
        <>
          <ActivityTable entries={groupDecisions(result.rows)} />
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
