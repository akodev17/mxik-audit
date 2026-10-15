import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { CatalogStatus } from '@/components/catalog-status';
import { CatalogSwitcher } from '@/components/catalog-switcher';
import { lookupCode } from '@/lib/audit-runner';
import { catalogForPage } from '@/lib/catalog-page';
import { db } from '@/lib/db';
import { decisionHistory } from '@/lib/decisions';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { hierarchyPath } from '@/core/match/rules';
import { DecisionHistory } from './decision-history';
import { ReviewList, type Alternative, type ReviewRow } from './review-list';

const PAGE_SIZE = 200;

/** Findings store alternatives as JSON; validate shape before trusting it. */
function readAlternatives(value: unknown): Alternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r['code'] !== 'string' || typeof r['name'] !== 'string') return [];
    return [{
      code: r['code'],
      name: r['name'],
      confidence: typeof r['confidence'] === 'number' ? r['confidence'] : 0,
      reason: typeof r['reason'] === 'string' ? r['reason'] : '',
      isBase: r['isBase'] === true,
    }];
  });
}

export default async function ReviewPage(
  { searchParams }: { searchParams: Promise<{ catalog?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;

  const { catalog, options } = await catalogForPage(user.orgId, params.catalog);

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
          <CatalogSwitcher options={options} current={catalog.id} />
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
    include: { item: { select: { rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
  });

  // One lookup per distinct suggested code, so the hierarchy path and bound unit
  // can be shown inline without an N+1 per row.
  const codes = [...new Set(findings.map((f) => f.suggestedMxik).filter((c): c is string => c !== null))];
  const details = new Map(
    (await Promise.all(codes.map(async (code) => [code, await lookupCode(code)] as const)))
      .filter(([, c]) => c !== null),
  );

  const rows: ReviewRow[] = findings.map((f) => {
    const detail = f.suggestedMxik ? details.get(f.suggestedMxik) : null;
    return {
      findingId: f.id,
      rowIndex: f.item.rowIndex,
      productName: f.item.rawName,
      currentMxik: f.item.existingMxik,
      unit: f.item.unit,
      type: f.type,
      severity: f.severity,
      reason: f.reason,
      suggestedMxik: f.suggestedMxik,
      suggestedName: detail?.nameUz ?? null,
      suggestedPath: detail ? hierarchyPath(detail) || null : null,
      suggestedUnit: detail && detail.unitBinding === 'strict' && detail.unitCanonical.length > 0
        ? detail.unitCanonical.join(' / ')
        : null,
      confidence: f.confidence,
      alternatives: readAlternatives(f.alternatives),
      decision: f.decision,
      chosenMxik: f.chosenMxik,
      decisionEventId: f.decisionEventId,
    };
  });

  const history = await decisionHistory(user, catalog.id);
  const selected = params.catalog ? catalog.id : null;

  return (
    <>
      <Header email={user.email} current="/review" catalogId={selected} demo={user.demo} />
      <Shell demo={user.demo}>
        <CatalogSwitcher options={options} current={catalog.id} />
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
