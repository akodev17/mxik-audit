import type { Metadata } from 'next';
import { fmtNumber } from '@tasnivo/i18n/format';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { ActiveQueueFilters } from './active-filters';
import { ClientCards } from './client-cards';
import { QueueFilters } from './filters';
import { QueueList } from './queue-list';
import { queueQuery, readQueueFilter, withQuery } from './queue-params';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.firmX.queue.title} — ${t.appName}` };
}

type Params = { client?: string; type?: string; severity?: string; flag?: string; accountant?: string; due?: string; after?: string };

export default async function QueuePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const q = ta.firmX.queue;
  const filter = readQueueFilter(sp);
  if (user.role !== 'admin') filter.accountantId = null;

  const page = await serverApi().workspace.queue(queueQuery(filter, sp.after));
  const { clients } = page;
  const people = page.accountants ?? [];
  const fmt = (n: number): string => fmtNumber(locale, n);
  const filters: Params = Object.fromEntries(Object.entries(sp).filter(([key]) => key !== 'after'));
  const active = Object.values(filters).some(Boolean);

  return (
    <Page title={q.title} hint={q.hint} wide>
      {user.role !== 'viewer' ? null : <p className="mb-4 rounded-md bg-info-tint px-3 py-2 text-small text-info-ink">{q.readOnly}</p>}
      <QueueFilters
        filter={filter} clients={clients}
        accountants={people.map((p) => ({ id: p.id, email: p.email, unrestricted: p.assigned === 0 }))}
        active={active}
      />
      <ActiveQueueFilters
        params={filters} clients={clients}
        accountants={people.map((p) => ({ id: p.id, email: p.email }))}
      />

      {page.byClient.length > 0 ? (
        <ClientCards byClient={page.byClient} rows={page.rows} total={page.total} filters={filters} current={filter.clientId} />
      ) : null}

      {page.rows.length === 0 ? (
        active || sp.after
          ? <EmptyState title={q.emptyFiltered} hint={q.emptyFilteredHint} action={<ButtonLink href="/queue" variant="secondary">{q.reset}</ButtonLink>} />
          : <EmptyState title={q.emptyTitle} hint={q.emptyHint} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-section">{q.total(fmt(page.total), page.total)}</h2>
            <span className="text-small text-muted" aria-live="polite">{q.showing(fmt(page.rows.length), fmt(page.total), page.total)}</span>
          </div>
          <QueueList rows={page.rows} />
          <nav aria-label={q.title} className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {sp.after ? <ButtonLink href={withQuery('/queue', filters)} variant="ghost" size="sm">{q.first}</ButtonLink> : null}
            {page.next ? <ButtonLink href={withQuery('/queue', filters, { after: page.next })} variant="secondary" size="sm">{q.next}</ButtonLink> : null}
          </nav>
        </>
      )}
    </Page>
  );
}
