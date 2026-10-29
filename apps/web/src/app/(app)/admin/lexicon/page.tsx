import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { Page } from '@/ui/page';
import { adminAllowed } from '../allowed';
import { LexiconView } from './lexicon-view';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${(await adminAllowed()) ? ta.lexiconX.title : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** The learned lexicon: synonym entries, unit aliases and global alias candidates. Platform admins only; everyone else gets a 404. */
export default async function LexiconPage() {
  const { t, ta } = await getI18n();
  const initial = await pageData(serverApi().admin.lexicon());
  return (
    <Page title={ta.lexiconX.title} hint={ta.lexiconX.hint} wide crumbs={[{ label: t.adminTitle, href: '/admin' }]}>
      <LexiconView initial={initial} />
    </Page>
  );
}
