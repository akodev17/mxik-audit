import Link from 'next/link';
import { CLIENT_FILTERS, CLIENT_SORTS, STALE_DAYS, type ClientFilter, type ClientSort, type FilterCounts } from '@/lib/client-stats';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@/lib/query-string';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';

type Props = {
  params: Record<string, string | undefined>;
  filter: ClientFilter;
  sort: ClientSort;
  staleDays: number;
  search: string;
  counts: FilterCounts;
};

/** Filter tabs with counts, then search, sort and the stale threshold as a GET form. */
export async function ClientFilters({ params, filter, sort, staleDays, search, counts }: Props) {
  const { locale, ta } = await getI18n();
  const words = ta.firmX.clients;
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
                  {f === 'stale' ? `${words.filters.stale} (${words.staleOption(staleDays)})` : words.filters[f]}
                  <span className="tabular-nums text-muted">{fmtNumber(locale, counts[f])}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <form action="/clients" className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
        {filter === 'all' ? null : <input type="hidden" name="filter" value={filter} />}
        <Field label={words.search}>
          <Input type="search" name="q" defaultValue={search} placeholder={words.searchPlaceholder} maxLength={100} />
        </Field>
        <Select label={words.sort} name="sort" defaultValue={sort}>
          {CLIENT_SORTS.map((s) => <option key={s} value={s}>{words.sorts[s]}</option>)}
        </Select>
        <Select label={words.staleLabel} name="days" defaultValue={String(staleDays)}>
          {STALE_DAYS.map((d) => <option key={d} value={d}>{words.staleOption(d)}</option>)}
        </Select>
        <Button type="submit" variant="secondary">{words.apply}</Button>
      </form>
    </div>
  );
}
