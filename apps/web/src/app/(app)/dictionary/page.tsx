import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite } from '@tasnivo/domain/access';
import { DICT_FILTERS, type DictFilter } from '@tasnivo/domain/dictionary-review';
import { DICT_PAGE, dictionaryPage } from '@tasnivo/domain/dictionary-ops';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { DictionarySearch } from './dictionary-search';
import { DictionaryTable, type DictRow } from './dictionary-table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dict.title} — ${t.appName}` };
}

const PAGE = DICT_PAGE;

export default async function DictionaryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; f?: string }> }) {
  const { ta, locale } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const x = ta.wsX.dict;
  const sp = await searchParams;
  const data = await dictionaryPage(user, sp, locale);
  // Entries are product names from every client's catalogues: a member scoped to some clients sees none of them.
  if (!data.available) {
    return (
      <Page title={ta.dict.title} hint={ta.dict.hint} wide>
        <EmptyState title={x.scopedTitle} hint={x.scopedHint} />
      </Page>
    );
  }
  const { q, page, filter, counts, total } = data;
  const rows: DictRow[] = data.rows.map(({ updatedAt, ...e }) => ({ ...e, updated: fmtDate(locale, updatedAt) }));
  const params = (over: { p?: number; f?: DictFilter }): string => {
    const f = over.f ?? filter;
    return `/dictionary?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== 'all' ? { f } : {}), page: String(over.p ?? 0) })}`;
  };
  const href = (p: number): string => params({ p });
  const editable = canWrite(user);

  return (
    <Page title={ta.dict.title} hint={ta.dict.hint} wide>
      <DictionarySearch initial={q} />
      {counts.all > 0 ? (
        <nav aria-label={x.filterLabel} className="mb-3 flex flex-wrap items-center gap-1 text-small">
          {DICT_FILTERS.filter((f) => f === 'all' || f === filter || counts[f] > 0).map((f) => (
            <Link key={f} href={params({ f })} aria-current={f === filter ? 'true' : undefined} className={cx('rounded-ctl px-2.5 py-1 font-medium', f === filter ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}>
              {x.filters[f]} <span className="tabular-nums text-subtle">{fmtNumber(locale, counts[f])}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      {filter === 'unverified' || filter === 'stale' ? <p className="mb-2 text-small text-muted">{x.filterHints[filter]}</p> : null}
      {rows.length === 0 ? (
        q || filter !== 'all' ? <EmptyState title={x.emptySearch} hint={x.emptySearchHint} /> : <EmptyState title={x.emptyTitle} hint={x.emptyHint} />
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
