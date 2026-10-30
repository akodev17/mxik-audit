import type { Metadata } from 'next';
import { cache } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, type Tone } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { Page } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../_manage/card';

type SearchParams = Promise<{ page?: string }>;

/** One page of the billing overview, read once per request by the metadata and the page; 404 to anyone but a platform admin. */
const billingOnce = cache((page: number) => serverApi().admin.billing({ page }));

const requestedPage = async (searchParams: SearchParams): Promise<number> =>
  Math.min(10_000, Math.max(1, Number.parseInt((await searchParams).page ?? '1', 10) || 1));
const pageHref = (page: number): string => (page > 1 ? `/admin/billing?page=${page}` : '/admin/billing');

const STATE_TONE: Record<'trial' | 'firm' | 'expired', Tone> = { trial: 'info', firm: 'good', expired: 'danger' };

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { t, ta } = await getI18n();
  // Not a platform admin: the tab gets the not-found title, as on the other admin pages (B14).
  const allowed = await billingOnce(await requestedPage(searchParams)).then(() => true, (error: unknown) => {
    if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
    throw error;
  });
  return { title: `${allowed ? ta.setX.adminBilling.title : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/**
 * Customer orgs' plans and payments for the platform operator, 50 orgs a page (newest first); the
 * 30-day figures cover every org. Test-mode payments are flagged and left out of the sums.
 */
export default async function AdminBillingPage({ searchParams }: { searchParams: SearchParams }) {
  const { locale, t, ta } = await getI18n();
  const a = ta.setX.adminBilling;
  const h = ta.setX.billing.history;
  const data = await pageData(billingOnce(await requestedPage(searchParams)));
  const n = (v: number): string => fmtNumber(locale, v);
  const date = (iso: string | null): string => (iso ? fmtDate(locale, iso) : a.none);
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = (data.page - 1) * data.pageSize + data.orgs.length;
  return (
    <Page title={a.title} hint={a.hint} wide crumbs={[{ label: t.adminTitle, href: '/admin' }]}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={a.orgs} value={n(data.total)} />
          <Stat label={a.paid30} value={n(data.last30.count)} />
          <Stat label={a.sum30} value={h.sum(n(data.last30.sum))} />
          <Stat label={a.test30} value={n(data.last30.test)} tone={data.last30.test > 0 ? 'warn' : 'neutral'} />
        </div>
        <Card title={a.orgs} flush>
          <Table label={a.orgs} className={FLUSH_TABLE} hoverRows>
            <thead>
              <tr>
                <Th>{a.org}</Th><Th>{a.plan}</Th><Th>{a.trialEnds}</Th><Th>{a.subscriptionEnds}</Th><Th>{a.lastPaid}</Th><Th numeric>{a.paid30}</Th><Th numeric>{a.sum30}</Th>
              </tr>
            </thead>
            <tbody>
              {data.orgs.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <span className="font-medium">{o.name}</span>
                    {o.closedAt ? <Badge className="ml-2 align-middle">{a.closed}</Badge> : null}
                  </Td>
                  <Td>
                    <StatusChip tone={STATE_TONE[o.state]}>{o.state === 'firm' && o.tier ? ta.prX.names[o.tier] : ta.plan.stateLabel[o.state]}</StatusChip>
                  </Td>
                  <Td className="whitespace-nowrap">{date(o.trialEndsAt)}</Td>
                  <Td className="whitespace-nowrap">{date(o.subscriptionUntil)}</Td>
                  <Td>
                    {o.lastPaid ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="whitespace-nowrap">{date(o.lastPaid.paidAt)} · {h.sum(n(o.lastPaid.amount))} · {o.lastPaid.provider ? h.providers[o.lastPaid.provider] ?? o.lastPaid.provider : a.none}</span>
                        {o.lastPaid.testMode ? <Badge tone="info">{h.test}</Badge> : null}
                      </span>
                    ) : a.none}
                  </Td>
                  <Td numeric>{n(o.last30.count)}{o.last30.test > 0 ? <span className="ml-1 text-muted">(+{n(o.last30.test)} {h.test.toLowerCase()})</span> : null}</Td>
                  <Td numeric>{h.sum(n(o.last30.sum))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {data.pageCount > 1 ? (
          <nav aria-label={a.pages} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-small tabular-nums text-muted">{a.range(n(from), n(to), n(data.total))}</p>
            <div className="flex gap-2">
              {data.page > 1 ? <ButtonLink href={pageHref(data.page - 1)} size="sm">{a.prev}</ButtonLink> : null}
              {data.page < data.pageCount ? <ButtonLink href={pageHref(data.page + 1)} size="sm">{a.next}</ButtonLink> : null}
            </div>
          </nav>
        ) : null}
      </div>
    </Page>
  );
}
