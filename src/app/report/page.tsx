import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConfidenceBadge, Header, Shell, TypeBadge } from '@/components/chrome';
import { CatalogStatus } from '@/components/catalog-status';
import { CatalogSwitcher } from '@/components/catalog-switcher';
import { CodeCell } from '@/components/code-cell';
import { BarcodeBadge, MarkingBadge, WhyThisCode } from '@/components/evidence';
import { resumeStaleAudits, STALE_MS } from '@/lib/audit-jobs';
import { catalogForPage } from '@/lib/catalog-page';
import { db } from '@/lib/db';
import { findingRows } from '@/lib/finding-view';
import { RISKY_ITEM } from '@/lib/risk';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { PrintButton } from './print-button';

type FindingType = 'MISSING' | 'NOT_FOUND' | 'MISMATCH' | 'UNIT_CONFLICT';

const TYPE_ORDER: FindingType[] = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'];

export default async function ReportPage(
  { searchParams }: { searchParams: Promise<{ type?: string; severity?: string; catalog?: string; marking?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;

  const { catalog, options, client } = await catalogForPage(user, params.catalog);

  if (!catalog) {
    return (
      <>
        <Header email={user.email} current="/report" demo={user.demo} />
        <Shell demo={user.demo}>
          <h1 className="text-2xl">{t.reportTitle}</h1>
          <p className="mt-4 text-ink-soft">
            Hali katalog yuklanmagan.{' '}
            <Link href="/upload" className="underline">{t.navUpload}</Link>
          </p>
        </Shell>
      </>
    );
  }

  const selected = params.catalog ? catalog.id : null;
  if (catalog.status !== 'ready') {
    // Picks up an audit whose worker died (server restart, crash).
    if (catalog.status === 'analyzing') await resumeStaleAudits(STALE_MS, catalog.id);
    return (
      <>
        <Header email={user.email} current="/report" catalogId={selected} demo={user.demo} />
        <Shell demo={user.demo}>
          <CatalogSwitcher options={options} current={catalog.id} client={client} />
          <CatalogStatus catalog={catalog} />
          <p className="mt-2 text-xs text-ink-faint">{catalog.filename}</p>
        </Shell>
      </>
    );
  }

  // Counts come from the database, not from loading every row into memory: a
  // 60,000-row catalogue must not be summarized in JS.
  const [byType, riskyRows, markingTotal, markingRisky] = await Promise.all([
    db.finding.groupBy({
      by: ['type'],
      where: { item: { catalogId: catalog.id } },
      _count: { _all: true },
    }),
    db.catalogItem.count({ where: { catalogId: catalog.id, ...RISKY_ITEM } }),
    db.catalogItem.count({ where: { catalogId: catalog.id, markingRequired: true } }),
    db.catalogItem.count({ where: { catalogId: catalog.id, markingRequired: true, ...RISKY_ITEM } }),
  ]);

  const counts = new Map<string, number>(byType.map((r) => [r.type, r._count._all]));
  const count = (type: FindingType): number => counts.get(type) ?? 0;

  const typeFilter = TYPE_ORDER.includes(params.type as FindingType)
    ? (params.type as FindingType)
    : null;
  const severityFilter = params.severity === 'high' || params.severity === 'medium'
    ? params.severity
    : null;
  const markingFilter = params.marking === '1';

  const findings = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id, ...(markingFilter ? { markingRequired: true } : {}) },
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
    },
    // Severity first, then least confident first: the rows a human most needs
    // to look at come to the top.
    orderBy: [{ severity: 'asc' }, { confidence: 'asc' }],
    take: 300,
    include: { item: { select: { id: true, rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
  });
  const { rows } = await findingRows(findings);

  const totalFindings = [...counts.values()].reduce((a, b) => a + b, 0);
  const clean = riskyRows === 0;
  // Filter links stay on the catalogue being viewed.
  const link = (query: string): string => {
    const q = new URLSearchParams(query);
    if (params.catalog) q.set('catalog', catalog.id);
    const qs = q.toString();
    return qs ? `/report?${qs}` : '/report';
  };

  return (
    <>
      <Header email={user.email} current="/report" catalogId={selected} demo={user.demo} />
      <Shell demo={user.demo}>
        <CatalogSwitcher options={options} current={catalog.id} client={client} />

        {/* The headline. Large, unmissable, and about risk — not features. */}
        <section className={`border-l-4 px-6 py-5 ${clean ? 'border-ok bg-ok-tint' : 'border-risk bg-risk-tint'}`}>
          <h1 className={`font-serif text-3xl leading-tight ${clean ? 'text-ok' : 'text-risk'}`}>
            {clean
              ? t.reportClean(catalog.rowCount)
              : t.reportHeadline(riskyRows, catalog.rowCount)}
          </h1>
          {!clean ? (
            <p className="mt-3 text-sm text-ink-soft tnum">
              {[
                count('MISSING') > 0 ? t.reportBreakdownMissing(count('MISSING')) : null,
                count('NOT_FOUND') > 0 ? t.reportBreakdownNotFound(count('NOT_FOUND')) : null,
                count('MISMATCH') > 0 ? t.reportBreakdownMismatch(count('MISMATCH')) : null,
                count('UNIT_CONFLICT') > 0 ? t.reportBreakdownUnit(count('UNIT_CONFLICT')) : null,
              ].filter(Boolean).join('  ·  ')}
            </p>
          ) : null}
          {markingTotal > 0 ? (
            <p className="mt-2 text-sm text-ink-soft tnum">
              <Link href={link('marking=1')} className="underline">{t.markingSummary(markingTotal, markingRisky)}</Link>
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-faint">
            {catalog.filename} · {catalog.createdAt.toLocaleDateString('uz-UZ')}
          </p>
        </section>

        <div className="no-print mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-faint">{t.reportFilterType}:</span>
            <Link
              href={link('')}
              className={typeFilter === null ? 'font-medium underline' : 'text-ink-soft hover:text-ink'}
            >
              {t.reportFilterAll}
            </Link>
            {TYPE_ORDER.filter((type) => count(type) > 0).map((type) => (
              <Link
                key={type}
                href={link(`type=${type}`)}
                className={typeFilter === type ? 'font-medium underline' : 'text-ink-soft hover:text-ink'}
              >
                <TypeBadge type={type} severity={type === 'MISSING' || type === 'NOT_FOUND' ? 'high' : 'medium'} />
                <span className="ml-1 tnum">{count(type)}</span>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink-faint">{t.reportFilterSeverity}:</span>
            <Link href={link('severity=high')} className={severityFilter === 'high' ? 'font-medium underline' : 'text-ink-soft hover:text-ink'}>
              {t.severityHigh}
            </Link>
            <Link href={link('severity=medium')} className={severityFilter === 'medium' ? 'font-medium underline' : 'text-ink-soft hover:text-ink'}>
              {t.severityMedium}
            </Link>
          </div>
          {markingTotal > 0 ? (
            <Link href={link('marking=1')} className={markingFilter ? 'font-medium underline' : 'text-ink-soft hover:text-ink'}>
              {t.markingFilter} <span className="tnum">{markingRisky}</span>
            </Link>
          ) : null}
          <div className="ml-auto flex items-center gap-4">
            <PrintButton label={t.reportPrint} />
            <a href={`/api/report-pdf?catalog=${catalog.id}`} target="_blank" rel="noopener" className="underline text-ink-soft hover:text-ink">
              {t.pdfDownload}
            </a>
            {riskyRows > 0 ? (
              <Link href={selected ? `/review?catalog=${selected}` : '/review'} className="bg-ink px-4 py-2 text-paper">
                {t.reportGoReview}
              </Link>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-8 text-ink-soft">{t.reportEmpty}</p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-rule">
            <table className="min-w-full text-sm">
              <thead className="bg-paper-tint">
                <tr className="text-left">
                  <th className="border-b border-rule px-3 py-2 font-medium">#</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewProduct}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.reportFilterType}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewCurrentCode}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewSuggested}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewConfidence}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.findingId} className="border-b border-rule align-top last:border-0">
                    <td className="px-3 py-2 text-ink-faint tnum">{r.rowIndex + 1}</td>
                    <td className="max-w-sm px-3 py-2">
                      <span className="block">{r.productName}</span>
                      <span className="block text-xs text-ink-faint">{r.reason}</span>
                      <span className="mt-1 block">
                        <MarkingBadge
                          current={r.currentInfo?.isMarked === true}
                          suggested={r.suggestedMxik !== r.currentMxik && r.suggestedInfo?.isMarked === true}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2"><TypeBadge type={r.type} severity={r.severity} /></td>
                    <td className="max-w-xs px-3 py-2">
                      <CodeCell code={r.currentMxik} info={r.currentInfo} empty={t.reviewNoCode} />
                    </td>
                    <td className="max-w-xs px-3 py-2">
                      <CodeCell code={r.suggestedMxik} info={r.suggestedInfo} />
                      {r.evidence?.barcode ? <span className="mt-1 block"><BarcodeBadge /></span> : null}
                      <span className="no-print block">
                        <WhyThisCode evidence={r.evidence} confidence={r.confidence} rowUnit={r.unit} codeUnit={r.suggestedInfo?.unit ?? null} />
                      </span>
                    </td>
                    <td className="px-3 py-2"><ConfidenceBadge confidence={r.confidence} barcode={r.evidence?.barcode} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalFindings > findings.length ? (
          <p className="mt-3 text-xs text-ink-faint">
            {findings.length} / {totalFindings} koʻrsatilgan.
          </p>
        ) : null}
      </Shell>
    </>
  );
}
