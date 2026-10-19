'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

/** GET form: the query lives in the URL, so a search can be shared and the back button works. */
export function DictionarySearch({ initial }: { initial: string }) {
  const { ta } = useI18n();
  const x = ta.wsX.dict;
  return (
    <form role="search" className="mb-4 flex max-w-xl gap-2">
      <Input name="q" defaultValue={initial} placeholder={x.search} aria-label={x.search} maxLength={80} />
      <Button type="submit" variant="secondary">{x.searchButton}</Button>
    </form>
  );
}
