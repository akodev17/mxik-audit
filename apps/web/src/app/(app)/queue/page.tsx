import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
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
      {user.role !== 'viewer' ? null : <p className="mb-4 text-small text-muted">{q.readOnly}</p>}
      <QueueFilters
        filter={filter} clients={clients}
        accountants={people.map((p) => ({ id: p.id, email: p.email, unrestricted: p.assigned === 0 }))}
        active={active}
      />

      {page.byClient.length > 1 ? (
        <nav aria-label={q.byClient} className="mb-5">
          <h2 className="mb-2 text-small font-medium text-muted">{q.byClient}</h2>
          <ul className="flex flex-wrap gap-2">
            {page.byClient.map((c) => {
              const current = filter.clientId === c.clientId;
              return (
                <li key={c.clientId}>
                  <Link
                    href={withQuery('/queue', filters, { client: current ? null : c.clientId })}
                    aria-current={current ? 'true' : undefined}
                    className={cx(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-small',
                      current ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface',
                    )}
                  >
                    <span className="max-w-[16rem] truncate">{c.name}</span>
                    <span className="font-medium tabular-nums">{fmt(c.findings)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {page.rows.length === 0 ? (
        active || sp.after
          ? <EmptyState title={q.emptyFiltered} hint={q.emptyFilteredHint} action={<ButtonLink href="/queue" variant="secondary">{q.reset}</ButtonLink>} />
          : <EmptyState title={q.emptyTitle} hint={q.emptyHint} />
      ) : (
        <>
          <p className="mb-2 text-small text-muted" aria-live="polite">
            {q.total(fmt(page.total), page.total)}
          </p>
          <QueueList rows={page.rows} />
          <nav aria-label={q.title} className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-small text-muted">{q.showing(fmt(page.rows.length), fmt(page.total), page.total)}</span>
            <span className="flex flex-wrap gap-2">
              {sp.after ? <ButtonLink href={withQuery('/queue', filters)} variant="ghost" size="sm">{q.first}</ButtonLink> : null}
              {page.next ? <ButtonLink href={withQuery('/queue', filters, { after: page.next })} variant="secondary" size="sm">{q.next}</ButtonLink> : null}
            </span>
          </nav>
        </>
      )}
    </Page>
  );
}
