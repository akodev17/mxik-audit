import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { serverApi } from '@/lib/api/server';
import { orNull } from '@/lib/catalogs/server';
import { getI18n } from '@/lib/locale';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { IconDownload, IconInfo } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { TasnivoMark } from '@/ui/logo';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';

type Params = { params: Promise<{ token: string }> };

/**
 * The link's client-facing report (share.view; null for an unknown, expired or revoked link), once
 * per request: metadata and page both need it, and each read counts a view.
 */
const shared = cache((token: string) => orNull(serverApi().share.view({ token })));

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
  return <span className="flex min-w-0 flex-col items-start gap-0.5"><CodeChip code={value.code} /><span className="max-w-full truncate text-micro text-muted" title={value.name ?? undefined}>{value.name}</span></span>;
}

/** Public, read-only report for one catalogue: the firm's brand, the totals, the findings; no comments, no other clients, nothing to edit. */
export default async function SharedReport({ params }: Params) {
  const { t, ta, locale } = await getI18n();
  const p = ta.importX.flow.publicPage;
  const { token } = await params;
  const found = await shared(token);
  if (!found) notFound();
  const { report: data, includePdf } = found;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const logo = data.logoUrl;
  const rows = data.rows.slice(0, SHOWN);
  const labels = typeLabels(t);

  return (
    <main className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-raised p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          {logo
            ? <img src={logo} alt="" className="max-h-12 max-w-[140px] shrink-0 object-contain" />
            : <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-md bg-brand-tint text-section text-brand-ink">{data.firmName.slice(0, 1)}</span>}
          <div className="min-w-0">
            <p className="truncate text-section">{data.firmName}</p>
            <p className="text-small text-muted">{ta.share.preparedFor(data.clientName)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" icon={<IconInfo size={12} />}>{p.readOnly}</Badge>
          {includePdf ? <a href={api.share.pdf.url({ token })} className={buttonClass('primary')}><IconDownload size={16} />{ta.share.downloadPdf}</a> : null}
        </div>
      </header>

      <div className="mt-8">
        <h1 className="break-words text-title">{data.filename}</h1>
        <p className="mt-1 text-small text-muted">
          <span className="tabular-nums">{fmtDate(locale, data.generatedAt)}</span>
          {data.classifierDate ? <>{' · '}{ta.ws.classifier}: <span className="tabular-nums">{fmtDate(locale, data.classifierDate)}</span></> : null}
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={ta.ws.rows} value={fmt(data.totalRows)} />
        <Stat label={ta.ws.risky} value={fmt(data.riskyRows)} tone={data.riskyRows > 0 ? 'danger' : 'good'} />
        {data.markingRows > 0 ? <Stat label={ta.ws.marking} value={fmt(data.markingRows)} /> : null}
      </div>
      {data.byType.length > 0 ? (
        <ul aria-label={p.findings} className="mt-4 flex flex-wrap gap-2">
          {data.byType.map((b) => (
            <li key={b.type}><Badge tone={typeTone(b.type, 'high')}>{labels[b.type] ?? b.type}: <span className="font-semibold tabular-nums">{fmt(b.count)}</span></Badge></li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="shared-findings" className="mt-8">
        <h2 id="shared-findings" className="mb-3 text-section">{p.findings}</h2>
        <Table label={p.findings} stickyHeader maxHeight="70vh">
          <thead><tr><Th numeric className="w-12">#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colStatus}</Th><Th>{ta.ws.colCurrent}</Th><Th>{ta.ws.colSuggested}</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.rowIndex}|${r.type}`} className={i % 2 === 1 ? '[&>td]:bg-surface' : undefined}>
                <Td numeric className="align-top text-muted">{fmt(r.rowIndex + 1)}</Td>
                <Td className="max-w-xs align-top font-medium"><span className="line-clamp-2" title={r.product}>{r.product}</span></Td>
                <Td className="align-top"><Badge tone={typeTone(r.type, 'high')}>{labels[r.type] ?? r.type}</Badge></Td>
                <Td className="max-w-[260px] align-top"><Code value={r.current} /></Td>
                <Td className="max-w-[260px] align-top"><Code value={r.chosen ?? r.suggested} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data.rows.length > SHOWN || data.truncated ? <p className="mt-2 text-small text-muted">{ta.share.firstRows(rows.length)}</p> : null}
      </section>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-small text-muted">
        <p className="max-w-2xl">{ta.share.footer}</p>
        <p className="inline-flex items-center gap-1.5"><TasnivoMark className="size-4 text-fg" />{p.poweredBy}</p>
      </footer>
    </main>
  );
}
