import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { CatalogSwitcher } from '@/components/catalog-switcher';
import { catalogForPage } from '@/lib/catalog-page';
import { db } from '@/lib/db';
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
