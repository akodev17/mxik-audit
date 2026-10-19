import { getI18n } from '@/lib/locale';
import { Field, Input } from '@/ui/input';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';

/**
 * The firm filter bar with one search field: a GET form, so the query lives in the URL (shareable,
 * back button works). Enter or "Apply" runs it; "Clear" appears while a query is set.
 */
export async function DictionarySearch({ initial }: { initial: string }) {
  const { ta } = await getI18n();
  const x = ta.wsX.dict;
  return (
    <div role="search">
      <FilterBar action="/dictionary" reset={initial ? '/dictionary' : null} compact fieldsClassName="grid-cols-1 sm:w-96">
        <Field label={x.searchLabel} className={FILTER_FIELD}>
          <Input type="search" name="q" defaultValue={initial} placeholder={x.search} maxLength={80} enterKeyHint="search" />
        </Field>
      </FilterBar>
    </div>
  );
}
