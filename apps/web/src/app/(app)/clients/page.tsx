import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ResponseOf, endpoints } from '@tasnivo/contracts';
import { CLIENT_FILTERS, CLIENT_SORTS, STALE_DAYS } from '@tasnivo/contracts/modules/clients';
import { canWrite } from '@/lib/pure/access';
import { rowProgress } from '@/lib/pure/client-kpi';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@/lib/pure/query-string';
import { agoText, daysSince } from '@/lib/pure/relative-day';
import { signedIn } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { IconChevron, IconInfo } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Progress } from '@/ui/progress';
import { Table, Td, Th } from '@/ui/table';
import { AvatarStack } from '../_manage/avatar';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { AddClient } from './add-client';
import { AttentionBadges } from './attention-badges';
import { ClickableRow } from './clickable-row';
import { ClientFilters } from './client-filters';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.clientsTitle} — ${t.appName}` };
}

type Params = { q?: string; filter?: string; sort?: string; days?: string; page?: string; new?: string };

type ClientRow = ResponseOf<typeof endpoints.clients.list>['rows'][number];

function Freshness({ c, ta, locale }: { c: ClientRow; ta: AppDict; locale: Locale }) {
  if (!c.auditedAt) return <span className="text-muted">{ta.firmX.clients.never}</span>;
  return (
    <span className="whitespace-nowrap">
      <time dateTime={c.auditedAt}>{agoText(ta.firmX.ago, daysSince(new Date(c.auditedAt)))}</time>
      <span className="block text-small text-muted">{fmtDate(locale, c.auditedAt)}</span>
    </span>
  );
}

function ReviewProgress({ c, ta, locale }: { c: ClientRow; ta: AppDict; locale: Locale }) {
  const p = rowProgress(c);
  if (!p) return <span className="text-muted">{ta.firmX.dash}</span>;
  const text = ta.firmX.progress.of(fmtNumber(locale, p.done), fmtNumber(locale, p.total), p.total);
  return (
    <span className="flex items-center gap-2">
      <Progress label={ta.firmX.progress.label} hideLabel value={p.done} max={p.total} valueText={text} size="sm" tone="good" className="w-20 shrink-0" />
      <span aria-hidden className="whitespace-nowrap text-small tabular-nums text-muted">{fmtNumber(locale, p.done)} / {fmtNumber(locale, p.total)}</span>
    </span>
  );
}

function Tags({ c, t, archivedLabel }: { c: ClientRow; t: { clientsDefault: string }; archivedLabel: string }) {
  if (!c.isDefault && !c.archivedAt) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {c.isDefault ? <Badge>{t.clientsDefault}</Badge> : null}
      {c.archivedAt ? <Badge tone="neutral">{archivedLabel}</Badge> : null}
    </span>
  );
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, t, ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const words = ta.firmX.clients;
  const filter = CLIENT_FILTERS.find((f) => f === sp.filter) ?? 'all';
  const sort = CLIENT_SORTS.find((s) => s === sp.sort) ?? 'attention';
  const staleDays = STALE_DAYS.find((d) => String(d) === sp.days) ?? STALE_DAYS[0];
  const search = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  // The API pages from 0; the address keeps counting from 1.
  const data = await pageData(serverApi().clients.list({ q: search || undefined, filter, sort, days: staleDays, page: page - 1 }));
  const demo = user.demo;
  const reasonsOf = (c: ClientRow) => c.attention;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const fmt = (n: number): string => fmtNumber(locale, n);
  const writer = canWrite(user) && !demo;
  const params: Record<string, string | undefined> = { ...sp, new: undefined };
  const filtered = filter !== 'all' || search !== '';
  const more = ta.mgX.clients.more;

  return (
    <Page
      title={t.clientsTitle} hint={words.hint} wide
      actions={writer
        ? <AddClient scoped={user.role !== 'admin' && user.clientIds !== null} initialOpen={sp.new === '1'} />
        : canWrite(user) ? null : <span className="text-small text-muted">{words.viewerNote}</span>}
    >
      <ClientFilters params={params} filter={filter} sort={sort} staleDays={staleDays} search={search} counts={data.counts} />

      {data.rows.length === 0 ? (
        <Card>
          {filter === 'archived' && !search
            ? <EmptyState size="compact" title={words.archivedNone} hint={words.archivedNoneHint} action={<ButtonLink href="/clients" variant="secondary">{words.showAll}</ButtonLink>} />
            : filtered
              ? <EmptyState size="compact" title={words.filteredTitle} hint={words.filteredHint} action={<ButtonLink href="/clients" variant="secondary">{ta.firmX.queue.reset}</ButtonLink>} />
              : <EmptyState size="compact" title={ta.clients.emptyTitle} hint={ta.clients.emptyHint} />}
        </Card>
      ) : (
        <>
          <p className="mb-2 text-small text-muted">{words.total(fmt(data.total), data.total)}</p>

          <Card flush className="hidden md:block">
            <Table label={t.clientsTitle} className={FLUSH_TABLE}>
              <thead>
                <tr>
                  <Th>{words.colName}</Th>
                  <Th>{words.colAttention}</Th>
                  <Th numeric>{words.colOpen}</Th>
                  <Th>{words.colProgress}</Th>
                  <Th>{words.colLastAudit}</Th>
                  <Th>
                    <span className="inline-flex items-center gap-1">
                      {words.colAccountants}
                      <IconButton label={words.accountantsNote} icon={<IconInfo size={14} />} size="compact" tooltipAlign="end" />
                    </span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <ClickableRow key={c.id} href={`/clients/${c.id}`}>
                    <Td className="max-w-[18rem] py-2.5">
                      <Link href={`/clients/${c.id}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
                      <Tags c={c} t={t} archivedLabel={words.archived} />
                    </Td>
                    <Td><AttentionBadges reasons={reasonsOf(c)} ta={ta} locale={locale} okLabel={c.archivedAt ? undefined : words.ok} openLabel={words.needsReview} /></Td>
                    <Td numeric className={c.openRows > 0 ? 'font-medium text-danger-ink' : undefined}>{c.catalogId ? fmt(c.openRows) : ta.firmX.dash}</Td>
                    <Td><ReviewProgress c={c} ta={ta} locale={locale} /></Td>
                    <Td><Freshness c={c} ta={ta} locale={locale} /></Td>
                    <Td className="max-w-[14rem]">
                      {c.accountants.length === 0
                        ? <span className="text-small text-muted">{words.unassigned}</span>
                        : <AvatarStack emails={c.accountants} moreLabel={more} />}
                    </Td>
                  </ClickableRow>
                ))}
              </tbody>
            </Table>
          </Card>

          <ul className="space-y-3 md:hidden">
            {data.rows.map((c) => {
              const reasons = reasonsOf(c);
              return (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="block rounded-lg border border-line bg-raised p-4 transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium [overflow-wrap:anywhere]">{c.name}</span>
                        <Tags c={c} t={t} archivedLabel={words.archived} />
                      </span>
                      <IconChevron size={16} className="mt-1 shrink-0 text-subtle" />
                    </span>
                    {reasons.length > 0 ? <span className="mt-2 block"><AttentionBadges reasons={reasons} ta={ta} locale={locale} openLabel={words.needsReview} /></span> : null}
                    <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-line pt-3 text-small">
                      <span><span className="block text-muted">{words.colOpen}</span><span className={c.openRows > 0 ? 'font-medium tabular-nums text-danger-ink' : 'font-medium tabular-nums'}>{c.catalogId ? fmt(c.openRows) : ta.firmX.dash}</span></span>
                      <span><span className="block text-muted">{words.colLastAudit}</span>{c.auditedAt ? agoText(ta.firmX.ago, daysSince(new Date(c.auditedAt))) : words.never}</span>
                      <span className="col-span-2"><span className="block text-muted">{words.colProgress}</span><ReviewProgress c={c} ta={ta} locale={locale} /></span>
                      <span className="col-span-2 min-w-0"><span className="mb-1 block text-muted">{words.colAccountants}</span>{c.accountants.length === 0 ? words.unassigned : <AvatarStack emails={c.accountants} moreLabel={more} />}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {pages > 1 ? (
            <nav aria-label={t.clientsTitle} className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-small text-muted">{words.page(page, pages)}</span>
              <span className="flex gap-2">
                {page > 1 ? <ButtonLink href={withQuery('/clients', params, { page: page - 1 > 1 ? String(page - 1) : null })} size="sm" variant="secondary">{words.prev}</ButtonLink> : null}
                {page < pages ? <ButtonLink href={withQuery('/clients', params, { page: String(page + 1) })} size="sm" variant="secondary">{words.next}</ButtonLink> : null}
              </span>
            </nav>
          ) : null}
        </>
      )}
    </Page>
  );
}
