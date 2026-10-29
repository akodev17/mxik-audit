import type { Metadata } from 'next';
import { cache } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, type Tone } from '@/ui/badge';
import { Page } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../_manage/card';

/** The billing overview, read once per request by the metadata and the page; 404 to anyone but a platform admin. */
const billingOnce = cache(() => serverApi().admin.billing());

const STATE_TONE: Record<'trial' | 'firm' | 'expired', Tone> = { trial: 'info', firm: 'good', expired: 'danger' };

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  // Not a platform admin: the tab gets the not-found title, as on the other admin pages (B14).
  const allowed = await billingOnce().then(() => true, (error: unknown) => {
    if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
    throw error;
  });
  return { title: `${allowed ? ta.setX.adminBilling.title : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** Every customer org's plan and payments, for the platform operator. Test-mode payments are flagged and left out of the sums. */
export default async function AdminBillingPage() {
  const { locale, t, ta } = await getI18n();
  const a = ta.setX.adminBilling;
  const h = ta.setX.billing.history;
  const data = await pageData(billingOnce());
  const n = (v: number): string => fmtNumber(locale, v);
  const date = (iso: string | null): string => (iso ? fmtDate(locale, iso) : a.none);
  return (
    <Page title={a.title} hint={a.hint} wide crumbs={[{ label: t.adminTitle, href: '/admin' }]}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={a.orgs} value={n(data.orgs.length)} />
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
      </div>
    </Page>
  );
}
