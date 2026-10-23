// The reconciliation of a bank statement: opening balance + credits − debits against the closing
// balance the bank printed, the bank's own totals row, totals by operation and by review status,
// the unresolved and skipped lines with their reasons, the rows that were not transactions, and
// the CSV of all of it.
import type { Metadata } from 'next';
import { fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../../_manage/card';
import { money } from '../../bank-pure';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.bankX.reconcile.title} — ${t.appName}` };
}

export default async function ReconcilePage({ params }: { params: Promise<{ batchId: string }> }) {
  const { locale, ta } = await getI18n();
  const b = ta.bankX;
  const r = b.reconcile;
  const { batchId } = await params;
  const report = await pageData(serverApi().bank.reconcile({ batchId }));
  const s = report.statement;
  const n = (v: number): string => fmtNumber(locale, v);
  const op = (key: string): string => (b.operations as Record<string, string>)[key] ?? key;
  const differenceTone = report.balanced === null ? 'neutral' : report.balanced ? 'good' : 'danger';
  const totalsMatch = (ok: boolean | null): string => (ok === null ? '' : ok ? ` (${r.matches})` : ` (${r.differs})`);

  return (
    <Page
      title={r.title} hint={s.filename ?? undefined} wide
      crumbs={[{ label: b.title, href: '/bank' }, { label: s.filename ?? s.id, href: `/bank/${batchId}` }]}
      actions={<ButtonLink href={`/api/bank/statements/${batchId}/reconcile.csv`} download leadingIcon={<IconDownload size={16} />}>{r.csv}</ButtonLink>}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={r.opening} value={money(report.openingBalance)} />
          <Stat label={r.credits} value={money(report.totalCredit)} tone="good" />
          <Stat label={r.debits} value={money(report.totalDebit)} />
          <Stat label={r.computed} value={money(report.computedClosing)} />
          <Stat label={r.closing} value={money(report.closingBalance)} />
          <Stat label={r.difference} value={report.difference === null ? '—' : money(report.difference)} tone={differenceTone} hint={report.balanced === null ? b.review.balanceUnknown : report.balanced ? b.review.balanceOk : undefined} />
        </div>

        <Card title={r.bankTotals}>
          <p className="text-data">
            {report.bankTotals.debit === null && report.bankTotals.credit === null ? r.none : (
              <>
                {b.review.columns.debit}: {money(report.bankTotals.debit)}{totalsMatch(report.bankTotals.debitMatches)} · {b.review.columns.credit}: {money(report.bankTotals.credit)}{totalsMatch(report.bankTotals.creditMatches)}
              </>
            )}
          </p>
          <p className="mt-1 text-small text-muted">{r.exported(report.exported)}</p>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {([[r.byOperation, report.byOperation, op], [r.byStatus, report.byStatus, (k: string) => (ta.accountingX.record as Record<string, string>)[k] ?? k]] as const).map(([title, rows, label]) => (
            <Card key={title} title={title} flush>
              <Table label={title} className={FLUSH_TABLE} density="compact">
                <thead><tr><Th>{title}</Th><Th numeric>{r.count}</Th><Th numeric>{b.review.columns.debit}</Th><Th numeric>{b.review.columns.credit}</Th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.key}><Td>{label(t.key)}</Td><Td numeric>{n(t.count)}</Td><Td numeric className="whitespace-nowrap">{money(t.debit)}</Td><Td numeric className="whitespace-nowrap">{money(t.credit)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>

        <Card title={`${r.unresolved} (${n(report.unresolved.length)})`} flush={report.unresolved.length > 0}>
          {report.unresolved.length === 0 ? <p className="text-data text-muted">{r.none}</p> : (
            <Table label={r.unresolved} className={FLUSH_TABLE} density="compact">
              <thead><tr><Th numeric>{b.review.columns.row}</Th><Th>{b.review.columns.issues}</Th><Th>{b.review.columns.purpose}</Th></tr></thead>
              <tbody>
                {report.unresolved.map((u) => (
                  <tr key={u.rowIndex}><Td numeric>{u.rowIndex}</Td><Td>{u.codes.map((c) => (b.issues as Record<string, string>)[c] ?? c).join(', ')}</Td><Td className="max-w-md truncate text-muted" title={u.text}>{u.text}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={`${r.skipped} (${n(report.skipped.length)})`} flush={report.skipped.length > 0}>
          {report.skipped.length === 0 ? <p className="text-data text-muted">{r.none}</p> : (
            <Table label={r.skipped} className={FLUSH_TABLE} density="compact">
              <thead><tr><Th numeric>{b.review.columns.row}</Th><Th>{b.edit.note}</Th><Th>{b.review.columns.purpose}</Th></tr></thead>
              <tbody>
                {report.skipped.map((k) => (
                  <tr key={k.rowIndex}><Td numeric>{k.rowIndex}</Td><Td>{k.note ?? '—'}</Td><Td className="max-w-md truncate text-muted" title={k.text}>{k.text}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={`${r.dropped} (${n(report.dropped.length)})`} flush={report.dropped.length > 0}>
          {report.dropped.length === 0 ? <p className="text-data text-muted">{r.none}</p> : (
            <Table label={r.dropped} className={FLUSH_TABLE} density="compact">
              <thead><tr><Th numeric>{b.upload.droppedRow}</Th><Th>{b.upload.droppedWhy}</Th></tr></thead>
              <tbody>
                {report.dropped.map((d) => (
                  <tr key={d.rowIndex}><Td numeric>{d.rowIndex}</Td><Td>{(b.dropReasons as Record<string, string>)[d.reason] ?? d.reason}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </Page>
  );
}
