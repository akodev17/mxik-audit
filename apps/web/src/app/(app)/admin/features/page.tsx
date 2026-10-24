import type { Metadata } from 'next';
import { cache } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Page } from '@/ui/page';
import { FeaturesForm } from './features-form';

/** The module table, read once per request by the metadata and the page; 404 to anyone but a platform admin. */
const featuresOnce = cache(() => serverApi().admin.features());

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  // Not a platform admin: the tab gets the not-found title, as on the other admin pages (B14).
  const allowed = await featuresOnce().then(() => true, (error: unknown) => {
    if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
    throw error;
  });
  return { title: `${allowed ? ta.featuresX.admin.title : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** The owner's switches for the product modules (packages/contracts/src/feature-modules.ts). Not linked from anywhere. */
export default async function FeaturesPage() {
  const { ta } = await getI18n();
  const rows = await pageData(featuresOnce());
  return (
    <Page title={ta.featuresX.admin.title} hint={ta.featuresX.admin.hint}>
      <FeaturesForm rows={rows.map(({ key, state }) => ({ key, state }))} />
    </Page>
  );
}
