import type { Metadata } from 'next';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Notice } from '../../../_manage/notice';
import { Card, Fact } from '../../../_manage/card';
import { StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { Page } from '@/ui/page';
import { PrintButton } from '@/ui/print-button';
import { periodLabel, planLabel, providerLabel, STATUS_TONE } from '../../billing-history';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.setX.billing.receipt.title} — ${t.appName}`, robots: { index: false } };
}

/**
 * A paid order's receipt for the org's admins, printable from the browser (the shell is left out of
 * the printout). Another org's order, an unpaid one, or a reader who is not an admin get the not-found page.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const { locale, t, ta } = await getI18n();
  const r = ta.setX.billing.receipt;
  const h = ta.setX.billing.history;
  const order = await pageData(serverApi().billing.receipt({ orderId }));
  return (
    <Page
      title={r.title}
      crumbs={[{ label: t.settingsTitle, href: '/settings?tab=plan' }]}
      actions={(
        <div className="no-print flex flex-wrap items-center gap-2">
          <PrintButton>{r.print}</PrintButton>
          <ButtonLink href="/settings?tab=plan" variant="secondary">{r.back}</ButtonLink>
        </div>
      )}
    >
      <div className="max-w-2xl space-y-4">
        {order.testMode ? <Notice tone="info">{r.testNote}</Notice> : null}
        {order.status === 'refunded' ? <Notice tone="warn">{r.refundedNote}</Notice> : null}
        <Card title={t.appName} actions={<StatusChip tone={STATUS_TONE[order.status]}>{h.statuses[order.status]}</StatusChip>}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label={r.number}>{order.id}</Fact>
            <Fact label={r.payer}>{order.orgName ?? '—'}</Fact>
            <Fact label={r.paidAt}>{order.paidAt ? fmtDateTime(locale, order.paidAt) : '—'}</Fact>
            <Fact label={h.plan}>{planLabel(order, ta, locale)}</Fact>
            <Fact label={h.period}>{periodLabel(order, ta, locale)}</Fact>
            <Fact label={h.provider}>{providerLabel(order.provider, ta)}</Fact>
            <Fact label={h.amount}>{h.sum(fmtNumber(locale, order.amount))}</Fact>
          </dl>
        </Card>
      </div>
    </Page>
  );
}
