import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { CatalogStatus } from '@/components/catalog-status';
import { CatalogSwitcher } from '@/components/catalog-switcher';
import { CodeCell } from '@/components/code-cell';
import { catalogForPage } from '@/lib/catalog-page';
import { db } from '@/lib/db';
import { findingRows } from '@/lib/finding-view';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';

export default async function ExportPage(
  { searchParams }: { searchParams: Promise<{ catalog?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;

  const { catalog, options } = await catalogForPage(user.orgId, params.catalog);

  if (!catalog) {
    return (
      <>
        <Header email={user.email} current="/export" demo={user.demo} />
        <Shell demo={user.demo}>
          <h1 className="text-2xl">{t.exportTitle}</h1>
          <p className="mt-4 text-ink-soft">
            Hali katalog yuklanmagan.{' '}
            <Link href="/upload" className="underline">{t.navUpload}</Link>
          </p>
        </Shell>
      </>
    );
  }

  if (catalog.status !== 'ready') {
    return (
      <>
        <Header email={user.email} current="/export" catalogId={params.catalog ? catalog.id : null} demo={user.demo} />
        <Shell demo={user.demo}>
          <CatalogSwitcher options={options} current={catalog.id} />
          <h1 className="mb-4 text-2xl">{t.exportTitle}</h1>
          <p className="mb-4 text-sm text-ink-soft">{t.exportNotReady}</p>
          <CatalogStatus catalog={catalog} />
        </Shell>
      </>
    );
  }

  const grouped = await db.finding.groupBy({
    by: ['decision'],
    where: { item: { catalogId: catalog.id } },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((g) => [g.decision, g._count._all]));
  const accepted = counts.get('accepted') ?? 0;
  const rejected = counts.get('rejected') ?? 0;
  const pending = counts.get('pending') ?? 0;
  const selected = params.catalog ? catalog.id : null;

  // What the downloaded file will actually change, with each code's meaning.
  const PREVIEW = 50;
  const changed = await db.finding.findMany({
    where: { item: { catalogId: catalog.id }, decision: 'accepted' },
    orderBy: { item: { rowIndex: 'asc' } },
    take: PREVIEW,
    include: { item: { select: { id: true, rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
  });
  const { rows: preview } = await findingRows(changed);

  return (
    <>
      <Header email={user.email} current="/export" catalogId={selected} demo={user.demo} />
      <Shell demo={user.demo}>
        <CatalogSwitcher options={options} current={catalog.id} />
        <h1 className="text-2xl">{t.exportTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.exportHint}</p>

        <dl className="mt-6 border border-rule">
          {[
            [t.exportStatusAccepted, accepted, 'text-ok'],
            [t.exportStatusRejected, rejected, 'text-ink-soft'],
            [t.exportStatusPending, pending, 'text-risk'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="flex items-baseline justify-between border-b border-rule px-4 py-3 last:border-0">
              <dt className="text-sm text-ink-soft">{String(label)}</dt>
              <dd className={`tnum text-lg ${String(tone)}`}>{Number(value).toLocaleString('uz-UZ')}</dd>
            </div>
          ))}
        </dl>

        {pending > 0 ? (
          <p className="mt-4 border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-ink-soft">
            {pending} pozitsiya hali koʻrib chiqilmagan — ular asl qiymatlari bilan eksport qilinadi.{' '}
            <Link href={selected ? `/review?catalog=${selected}` : '/review'} className="underline">{t.navReview}</Link>
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="mb-3 text-lg">{t.exportPreviewTitle}</h2>
          {preview.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.exportPreviewEmpty}</p>
          ) : (
            <div className="overflow-x-auto border border-rule">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-tint">
                  <tr className="text-left">
                    <th className="border-b border-rule px-3 py-2 font-medium">#</th>
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewProduct}</th>
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.exportBefore}</th>
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.exportAfter}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.findingId} className="border-b border-rule align-top last:border-0">
                      <td className="px-3 py-2 text-ink-faint tnum">{r.rowIndex + 1}</td>
                      <td className="max-w-sm px-3 py-2">{r.productName}</td>
                      <td className="max-w-xs px-3 py-2"><CodeCell code={r.currentMxik} info={r.currentInfo} empty={t.reviewNoCode} /></td>
                      <td className="max-w-xs px-3 py-2"><CodeCell code={r.chosenMxik} info={r.chosenInfo} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {accepted > preview.length ? (
            <p className="mt-2 text-xs text-ink-faint">{t.exportPreviewMore(accepted - preview.length)}</p>
          ) : null}
        </section>

        <a
          href={`/api/export?catalog=${catalog.id}`}
          className="mt-6 inline-block bg-ink px-5 py-2.5 text-paper"
          download
        >
          {t.exportDownload}
        </a>

        <p className="mt-3 text-xs text-ink-faint">
          {catalog.filename} · {catalog.rowCount.toLocaleString('uz-UZ')} {t.rows}
        </p>
      </Shell>
    </>
  );
}
