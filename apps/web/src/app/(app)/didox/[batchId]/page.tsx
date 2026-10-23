// One Didox invoice: header card, document-level issues, the print form when there is one, the
// line review and the "Prepare for 1C" step.
import type { Metadata } from 'next';
import { fmtDate } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite } from '@/lib/pure/access';
import { Alert } from '@/ui/alert';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { IconPrint } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Card } from '../../_manage/card';
import { DeleteInvoiceButton } from '../delete-button';
import { batchTone, decimalText, severityTone } from '../model';
import { InvoiceReview } from './review';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.didoxX.title} — ${t.appName}` };
}

export default async function DidoxInvoicePage({ params }: { params: Promise<{ batchId: string }> }) {
  const { locale, ta } = await getI18n();
  const d = ta.didoxX;
  const { batchId } = await params;
  const api = serverApi();
  const [user, detail] = await Promise.all([pageData(api.auth.me()), pageData(api.didox.get({ batchId }))]);
  const { invoice, meta } = detail;
  const writable = canWrite(user) && !user.demo;
  const tone = batchTone(invoice.status);
  const party = (p: typeof meta.seller): string => [p.name || '—', p.inn].filter(Boolean).join(' · ');

  return (
    <Page
      title={`${invoice.sellerName || '—'} · № ${meta.number}`} hint={`${fmtDate(locale, meta.date)}${invoice.clientName ? ` · ${invoice.clientName}` : ''}`}
      wide crumbs={[{ label: d.detail.back, href: '/didox' }]}
      actions={(
        <>
          <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.accountingX.status[invoice.status as keyof typeof ta.accountingX.status] ?? invoice.status}</StatusChip>
          {writable ? <DeleteInvoiceButton batchId={invoice.id} label={`${invoice.sellerName} · ${meta.number}`} lines={invoice.counts?.total ?? 0} after="/didox" /> : null}
        </>
      )}
    >
      <div className="space-y-6">
        <Alert tone="info">{d.unverified}</Alert>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card title={d.detail.totals}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-data sm:grid-cols-2">
              <div><dt className="text-small text-muted">{d.detail.seller}</dt><dd className="font-medium">{party(meta.seller)}</dd></div>
              <div><dt className="text-small text-muted">{d.detail.buyer}</dt><dd>{party(meta.buyer)}</dd></div>
              <div><dt className="text-small text-muted">{d.detail.contract}</dt><dd>{meta.contractNumber ? `${meta.contractNumber}${meta.contractDate ? ` · ${fmtDate(locale, meta.contractDate)}` : ''}` : '—'}</dd></div>
              <div><dt className="text-small text-muted">{d.detail.didoxStatus}</dt><dd>{meta.didoxStatus ?? '—'}{invoice.externalRef ? <span className="block truncate font-mono text-small text-muted">{invoice.externalRef}</span> : null}</dd></div>
              <div><dt className="text-small text-muted">{d.detail.amount}</dt><dd className="tabular-nums">{decimalText(meta.totalAmount, { money: true })} {meta.currency}</dd></div>
              <div><dt className="text-small text-muted">{d.detail.vat}</dt><dd className="tabular-nums">{decimalText(meta.totalVat, { money: true })}</dd></div>
              <div className="sm:col-span-2"><dt className="text-small text-muted">{d.detail.withVat}</dt><dd className="text-title tabular-nums">{decimalText(meta.totalWithVat, { money: true })} {meta.currency}</dd></div>
            </dl>
            {detail.batchIssues.length > 0 ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-small text-muted">{d.detail.batchIssues}</p>
                <ul className="flex flex-wrap gap-2">
                  {detail.batchIssues.map((i) => <li key={i.code}><Badge tone={severityTone(i.severity)}>{d.issues[i.code] ?? i.code}</Badge></li>)}
                </ul>
              </div>
            ) : null}
          </Card>
          {/* Not embedded: the app's CSP allows no same-origin frames (frame-src, X-Frame-Options DENY); handoff-agent3.md. */}
          <Card title={d.detail.pdf}>
            {invoice.hasPdf ? (
              <ButtonLink href={`/api/didox/invoices/${invoice.id}/pdf`} target="_blank" leadingIcon={<IconPrint size={16} />}>{d.detail.openPdf}</ButtonLink>
            ) : <p className="text-small text-muted">{d.detail.noPdf}</p>}
          </Card>
        </div>
        <InvoiceReview detail={detail} writable={writable} />
      </div>
    </Page>
  );
}
