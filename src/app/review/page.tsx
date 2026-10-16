import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { CatalogStatus } from '@/components/catalog-status';
import { CatalogSwitcher } from '@/components/catalog-switcher';
import { catalogForPage } from '@/lib/catalog-page';
import { db } from '@/lib/db';
import { decisionHistory } from '@/lib/decisions';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { DecisionHistory } from './decision-history';
import { findingRows } from '@/lib/finding-view';
import { ReviewList } from './review-list';

const PAGE_SIZE = 200;

export default async function ReviewPage(
  { searchParams }: { searchParams: Promise<{ catalog?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;

  const { catalog, options, client } = await catalogForPage(user, params.catalog);

  if (!catalog) {
    return (
      <>
        <Header email={user.email} current="/review" demo={user.demo} />
        <Shell demo={user.demo}>
          <h1 className="text-2xl">{t.reviewTitle}</h1>
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
        <Header email={user.email} current="/review" catalogId={params.catalog ? catalog.id : null} demo={user.demo} />
        <Shell demo={user.demo}>
          <CatalogSwitcher options={options} current={catalog.id} client={client} />
          <CatalogStatus catalog={catalog} />
        </Shell>
      </>
    );
  }

  const findings = await db.finding.findMany({
    where: { item: { catalogId: catalog.id } },
    // Undecided first, then medium-confidence before high: the rows that need a
    // human eye are the ones shown first, per the brief.
    orderBy: [{ decision: 'asc' }, { confidence: 'asc' }],
    take: PAGE_SIZE,
    include: { item: { select: { id: true, rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
  });

  // Every code on the page with its classifier meaning, in one query.
  const { rows } = await findingRows(findings);

  const history = await decisionHistory(user, catalog.id);
  const selected = params.catalog ? catalog.id : null;

  return (
    <>
      <Header email={user.email} current="/review" catalogId={selected} demo={user.demo} />
      <Shell demo={user.demo}>
        <CatalogSwitcher options={options} current={catalog.id} client={client} />
        <h1 className="mb-1 text-2xl">{t.reviewTitle}</h1>
        <p className="mb-6 text-sm text-ink-faint">{catalog.filename}</p>
        <ReviewList catalogId={catalog.id} rows={rows} />
        <DecisionHistory
          entries={history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }))}
        />
      </Shell>
    </>
  );
}
