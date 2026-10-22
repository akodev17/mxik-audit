import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite } from '@/lib/access';
import { codeDetails } from '@/lib/code-details';
import { db } from '@/lib/db';
import { mayUseDictionary } from '@/lib/dictionary';
import { approverEmails, dictionaryCounts, dictionaryWhere, parseDictFilter, retiredEntryCodes, DICT_FILTERS, type DictFilter } from '@/lib/dictionary-review';
import { fmtDate, fmtNumber } from '@/lib/format';
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

const PAGE = 100;

export default async function DictionaryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; f?: string }> }) {
  const { ta, locale } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const x = ta.wsX.dict;
  // Entries are product names from every client's catalogues: a member scoped to some clients sees none of them.
  if (!mayUseDictionary(user)) {
    return (
      <Page title={ta.dict.title} hint={ta.dict.hint} wide>
        <EmptyState title={x.scopedTitle} hint={x.scopedHint} />
      </Page>
    );
  }
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));
  const filter = parseDictFilter(sp.f);

  const retired = await retiredEntryCodes(user.orgId);
  const where = dictionaryWhere(user.orgId, filter, retired, q);
  const [counts, total, entries] = await Promise.all([
    dictionaryCounts(user.orgId, q),
    db.firmMapping.count({ where }),
    db.firmMapping.findMany({ where, orderBy: [{ uses: 'desc' }, { updatedAt: 'desc' }], skip: page * PAGE, take: PAGE }),
  ]);
  const [details, approvers] = await Promise.all([
    codeDetails(entries.map((e) => e.code), locale),
    approverEmails(user.orgId, entries.map((e) => e.updatedBy ?? e.createdBy)),
  ]);
  const rows: DictRow[] = entries.map((e) => ({
    id: e.id, kind: e.kind, label: e.label, unit: e.unit, code: e.code, codeName: details.get(e.code)?.name ?? null,
    uses: e.uses, confirmations: e.confirmations, source: e.source,
    approver: approvers.get(e.updatedBy ?? e.createdBy ?? '') ?? null,
    stale: e.staleAt !== null || details.get(e.code)?.live === false, updated: fmtDate(locale, e.updatedAt),
  }));
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
