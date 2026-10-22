import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fmtDate, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { reportPdfData } from '@/lib/pdf/report-data';
import { countView, resolveShare } from '@/lib/share';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { typeLabels, typeTone } from '@/ui/labels';
import { Table, Td, Th } from '@/ui/table';

type Params = { params: Promise<{ token: string }> };

/** The link and its report, once per request (metadata and page both need it). */
const shared = cache(async (token: string) => {
  const share = await resolveShare(token);
  const data = share ? await reportPdfData(share.orgId, share.catalogId) : null;
  return share && data ? { share, data } : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const found = await shared((await params).token);
  const title = found ? ta.share.pageTitle : ta.share.invalid;
  return { title: `${title} — ${t.appName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

const SHOWN = 300;

type Coded = { code: string; name: string | null } | null;
function Code({ value }: { value: Coded }) {
  if (!value) return <span className="text-muted">—</span>;
  return <span className="flex min-w-0 flex-col items-start gap-0.5"><CodeChip code={value.code} /><span className="max-w-full truncate text-xs text-muted" title={value.name ?? undefined}>{value.name}</span></span>;
}

/** Public, read-only report for one catalogue: no comments, no other clients, nothing to edit. */
export default async function SharedReport({ params }: Params) {
  const { t, ta, locale } = await getI18n();
  const { token } = await params;
  const found = await shared(token);
  if (!found) notFound();
  const { share, data } = found;
  const fmt = (n: number): string => fmtNumber(locale, n);
  await countView(share.id);
  const logo = data.logo ? `data:${data.logo.mime};base64,${data.logo.data.toString('base64')}` : null;
  const rows = data.rows.slice(0, SHOWN);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-4">
          {logo ? <img src={logo} alt="" className="max-h-12 max-w-[160px]" /> : null}
          <div>
            <p className="text-lg font-bold">{data.firmName}</p>
            <p className="text-sm text-muted">{ta.share.preparedFor(data.clientName)}</p>
          </div>
        </div>
        {share.includePdf ? <a href={`/r/${token}/pdf`} className={buttonClass('primary')}>{ta.share.downloadPdf}</a> : null}
      </header>

      <h1 className="mt-6 text-2xl">{data.filename}</h1>
      <p className="mt-1 text-sm text-muted">
        {fmtDate(locale, data.generatedAt)}
        {data.classifierDate ? `, ${ta.ws.classifier.toLowerCase()}: ${fmtDate(locale, data.classifierDate)}` : ''}
      </p>

      <dl className="mt-5 flex flex-wrap gap-8">
        <div><dt className="text-xs text-muted">{ta.ws.rows}</dt><dd className="text-2xl font-bold">{fmt(data.totalRows)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.ws.risky}</dt><dd className="text-2xl font-bold text-danger">{fmt(data.riskyRows)}</dd></div>
        {data.markingRows > 0 ? <div><dt className="text-xs text-muted">{ta.ws.marking}</dt><dd className="text-2xl font-bold">{fmt(data.markingRows)}</dd></div> : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.byType.map((b) => <Badge key={b.type} tone={typeTone(b.type, 'high')}>{typeLabels(t)[b.type] ?? b.type}: {fmt(b.count)}</Badge>)}
      </div>

      <div className="mt-6">
        <Table>
          <thead><tr><Th>#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colStatus}</Th><Th>{ta.ws.colCurrent}</Th><Th>{ta.ws.colSuggested}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.rowIndex}|${r.type}`}>
                <Td className="text-muted">{r.rowIndex + 1}</Td>
                <Td className="max-w-xs truncate font-medium" title={r.product}>{r.product}</Td>
                <Td><Badge tone={typeTone(r.type, 'high')}>{typeLabels(t)[r.type] ?? r.type}</Badge></Td>
                <Td className="max-w-[260px]"><Code value={r.current} /></Td>
                <Td className="max-w-[260px]"><Code value={r.chosen ?? r.suggested} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data.rows.length > SHOWN || data.truncated ? <p className="mt-2 text-xs text-muted">{ta.share.firstRows(rows.length)}</p> : null}
      </div>
      <p className="mt-8 text-xs text-muted">{ta.share.footer}</p>
    </main>
  );
}
