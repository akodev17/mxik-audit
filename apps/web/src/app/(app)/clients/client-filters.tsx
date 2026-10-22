import Link from 'next/link';
import { CLIENT_FILTERS, CLIENT_SORTS, STALE_DAYS, type ClientFilter, type ClientSort, type FilterCounts } from '@tasnivo/domain/client-stats';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@tasnivo/domain/query-string';
import { cx } from '@/ui/cx';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';

type Props = {
  params: Record<string, string | undefined>;
  filter: ClientFilter;
  sort: ClientSort;
  staleDays: number;
  search: string;
  counts: FilterCounts;
};

/** Filter tabs with counts, then search and sort as a GET form; the stale threshold only on its own tab. */
export async function ClientFilters({ params, filter, sort, staleDays, search, counts }: Props) {
  const { locale, ta } = await getI18n();
  const words = ta.firmX.clients;
  const stale = filter === 'stale';
  const changed = search !== '' || sort !== 'attention' || (stale && staleDays !== STALE_DAYS[0]);
  return (
    <div className="mb-5 space-y-3">
      <nav aria-label={words.show}>
        <ul className="flex flex-wrap gap-2">
          {CLIENT_FILTERS.map((f) => {
            const current = f === filter;
            return (
              <li key={f}>
                <Link
                  href={withQuery('/clients', params, { filter: f === 'all' ? null : f, page: null })}
                  aria-current={current ? 'page' : undefined}
                  className={cx(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-small',
                    current ? 'border-brand bg-brand-tint font-medium text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface',
                  )}
                >
                  {f === 'stale' ? `${words.filters.stale} (${words.staleTab(staleDays)})` : words.filters[f]}
                  <span className="tabular-nums text-muted">{fmtNumber(locale, counts[f])}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <FilterBar
        action="/clients"
        reset={changed ? withQuery('/clients', {}, { filter: filter === 'all' ? null : filter }) : null}
        fieldsClassName={stale ? 'grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}
      >
        {filter === 'all' ? null : <input type="hidden" name="filter" value={filter} />}
        <Field label={words.search} className={FILTER_FIELD}>
          <Input type="search" name="q" defaultValue={search} placeholder={words.searchPlaceholder} maxLength={100} />
        </Field>
        <Select label={words.sort} name="sort" defaultValue={sort} wrapperClassName={FILTER_FIELD}>
          {CLIENT_SORTS.map((s) => <option key={s} value={s}>{words.sorts[s]}</option>)}
        </Select>
        {stale ? (
          <Select label={words.staleLabel} name="days" defaultValue={String(staleDays)} wrapperClassName={FILTER_FIELD}>
            {STALE_DAYS.map((d) => <option key={d} value={d}>{words.staleOption(d)}</option>)}
          </Select>
        ) : staleDays !== STALE_DAYS[0] ? <input type="hidden" name="days" value={String(staleDays)} /> : null}
      </FilterBar>
    </div>
  );
}
