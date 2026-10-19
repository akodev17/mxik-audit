import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { canWrite } from '@/lib/access';
import { codeDetails } from '@/lib/code-details';
import { db } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/format';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { DictionarySearch } from './dictionary-search';
import { DictionaryTable, type DictRow } from './dictionary-table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dict.title} — ${t.appName}` };
}

const PAGE = 100;

export default async function DictionaryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { ta, locale } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const x = ta.wsX.dict;
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));

  const where = {
    orgId: user.orgId,
    ...(q ? { OR: [{ label: { contains: q, mode: 'insensitive' as const } }, { key: { startsWith: q } }, { code: { startsWith: q } }] } : {}),
  };
  const [total, entries] = await Promise.all([
    db.firmMapping.count({ where }),
    db.firmMapping.findMany({ where, orderBy: [{ uses: 'desc' }, { updatedAt: 'desc' }], skip: page * PAGE, take: PAGE }),
  ]);
  const details = await codeDetails(entries.map((e) => e.code), locale);
  const rows: DictRow[] = entries.map((e) => ({
    id: e.id, kind: e.kind, label: e.label, unit: e.unit, code: e.code, codeName: details.get(e.code)?.name ?? null,
    uses: e.uses, confirmations: e.confirmations, source: e.source,
    stale: e.staleAt !== null || details.get(e.code)?.live === false, updated: fmtDate(locale, e.updatedAt),
  }));
  const href = (p: number): string => `/dictionary?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  const editable = canWrite(user);

  return (
    <Page title={ta.dict.title} hint={ta.dict.hint} wide>
      <DictionarySearch initial={q} />
      {rows.length === 0 ? (
        q ? <EmptyState title={x.emptySearch} hint={x.emptySearchHint} /> : <EmptyState title={x.emptyTitle} hint={x.emptyHint} />
      ) : (
        <>
          {editable ? null : <p className="mb-2 text-small text-muted">{x.viewerHint}</p>}
          <DictionaryTable rows={rows} canEdit={editable} />
          <nav aria-label={x.pages} className="mt-3 flex flex-wrap items-center gap-3 text-small text-muted">
            <span>{x.total(fmtNumber(locale, total), total)}</span>
            {page > 0 ? <ButtonLink size="sm" href={href(page - 1)}>{x.prev}</ButtonLink> : null}
            {(page + 1) * PAGE < total ? <ButtonLink size="sm" href={href(page + 1)}>{x.next}</ButtonLink> : null}
          </nav>
        </>
      )}
    </Page>
  );
}
