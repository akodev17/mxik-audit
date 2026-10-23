import Link from 'next/link';
import { CLIENT_FILTERS, CLIENT_SORTS, STALE_DAYS } from '@tasnivo/contracts/modules/clients';
import type { ClientFilter, ClientSort, FilterCounts } from '@/lib/pure/types';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@/lib/pure/query-string';
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
    <div className="mb-4 space-y-4">
      <nav aria-label={words.show} className="relative -mx-4 sm:mx-0">
        {/* One row that scrolls sideways on a phone; the baseline is an inset shadow the active underline covers. */}
        <ul className="flex gap-1 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden">
          {CLIENT_FILTERS.map((f) => {
            const current = f === filter;
            return (
              <li key={f} className="shrink-0">
                <Link
                  href={withQuery('/clients', params, { filter: f === 'all' ? null : f, page: null })}
                  aria-current={current ? 'page' : undefined}
                  className={cx(
                    'inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-data font-medium transition-colors duration-(--duration-fast) focus-visible:outline-offset-[-2px]',
                    current ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg',
                  )}
                >
                  {f === 'stale' ? `${words.filters.stale} (${words.staleTab(staleDays)})` : words.filters[f]}
                  <span className={cx('rounded-full px-1.5 text-micro tabular-nums', current ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-muted')}>{fmtNumber(locale, counts[f])}</span>
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
