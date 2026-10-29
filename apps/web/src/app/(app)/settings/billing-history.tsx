import Link from 'next/link';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import { Badge, StatusChip, type Tone } from '@/ui/badge';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';

/** One order as GET /api/billing/orders answers it. */
export type OrderView = ResponseOf<typeof endpoints.billing.orders>[number];

export const STATUS_TONE: Record<OrderView['status'], Tone> = { created: 'neutral', paid: 'good', cancelled: 'neutral', refunded: 'warn' };

/** "Korxona" for a subscription, "Katalog, 500 qatorgacha" for a catalogue, the raw id for an unknown plan. */
export function planLabel(o: OrderView, ta: AppDict, locale: Locale): string {
  const h = ta.setX.billing.history;
  if (o.kind === 'subscription' && o.tier) return ta.prX.names[o.tier];
  if (o.kind === 'catalog' && o.maxRows !== null) return h.catalog(fmtNumber(locale, o.maxRows));
  return o.planId;
}

/** The months bought, and the end the payment set when it is known. */
export function periodLabel(o: OrderView, ta: AppDict, locale: Locale): string {
  const h = ta.setX.billing.history;
  if (o.kind !== 'subscription' || o.months === null) return '—';
  return o.periodEnd ? `${h.months(o.months)}, ${h.until(fmtDate(locale, o.periodEnd))}` : h.months(o.months);
}

export const providerLabel = (provider: string | null, ta: AppDict): string => (provider ? ta.setX.billing.history.providers[provider] ?? provider : '—');

/** The plan tab's order list for the org's admins; each paid (or refunded) order links to its receipt. */
export function BillingHistory({ orders, ta, locale }: { orders: OrderView[]; ta: AppDict; locale: Locale }) {
  const h = ta.setX.billing.history;
  return (
    <Card id="history" title={h.title} hint={h.hint} flush={orders.length > 0}>
      {orders.length === 0 ? <p className="text-small text-muted">{h.empty}</p> : (
        <Table label={h.title} className={FLUSH_TABLE}>
          <thead>
            <tr>
              <Th>{h.date}</Th><Th>{h.plan}</Th><Th>{h.period}</Th><Th numeric>{h.amount}</Th><Th>{h.provider}</Th><Th>{h.status}</Th><Th><span className="sr-only">{h.receipt}</span></Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <Td className="whitespace-nowrap">{fmtDate(locale, o.paidAt ?? o.createdAt)}</Td>
                <Td>{planLabel(o, ta, locale)}</Td>
                <Td className="whitespace-nowrap text-muted">{periodLabel(o, ta, locale)}</Td>
                <Td numeric>{h.sum(fmtNumber(locale, o.amount))}</Td>
                <Td>{providerLabel(o.provider, ta)}</Td>
                <Td>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <StatusChip tone={STATUS_TONE[o.status]}>{h.statuses[o.status]}</StatusChip>
                    {o.testMode ? <Badge tone="info">{h.test}</Badge> : null}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {o.status === 'paid' || o.status === 'refunded' ? (
                    <Link href={`/settings/receipt/${encodeURIComponent(o.id)}`} className="font-medium text-brand-ink hover:underline">{h.receipt}</Link>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
