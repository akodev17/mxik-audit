import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { readDictParams } from './dictionary-params';
import { DictionaryExplainer } from './dictionary-explainer';
import { DictionarySearch } from './dictionary-search';
import { DictionaryView } from './dictionary-view';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dict.title} — ${t.appName}` };
}

export default async function DictionaryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; f?: string }> }) {
  const { ta } = await getI18n();
  const x = ta.wsX.dict;
  const { q, page, filter } = readDictParams(await searchParams);
  const listing = serverApi().dictionary.list({ ...(q ? { q } : {}), ...(filter !== 'all' ? { f: filter } : {}), page });
  listing.catch(() => undefined); // awaited below, after a missing session has redirected
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const data = await listing;
  // Entries are product names from every client's catalogues: a member scoped to some clients sees none of them.
  if (!data.available) {
    return (
      <Page title={ta.dict.title} hint={ta.dict.hint} wide>
        <EmptyState title={x.scopedTitle} hint={x.scopedHint} />
      </Page>
    );
  }

  return (
    <Page title={ta.dict.title} hint={ta.dict.hint} wide>
      <DictionaryExplainer admin={user.role === 'admin'} />
      <DictionarySearch initial={q} />
      <DictionaryView key={`${q}|${filter}|${page}`} q={q} filter={filter} page={page} initial={data} editable={user.role !== 'viewer'} />
    </Page>
  );
}
