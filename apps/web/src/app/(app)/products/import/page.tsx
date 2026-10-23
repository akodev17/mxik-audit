import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { canWrite } from '@/lib/catalogs/report';
import { signedInUser } from '@/lib/catalogs/server';
import { getI18n } from '@/lib/locale';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { ImportWizard } from './import-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.productsX.importWizard.title} — ${t.appName}` };
}

/** The product catalogue import: file → columns → check (chunked, with progress) → review and save. `?batch=` reopens one. */
export default async function ProductImportPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { t, ta } = await getI18n();
  const x = ta.productsX;
  const user = await signedInUser();
  const { batch } = await searchParams;
  const crumbs = [{ label: x.title, href: '/products' }];
  if (user.demo) return <Page title={x.importWizard.title} crumbs={crumbs}><EmptyState title={t.demoUploadDisabled} /></Page>;
  if (!canWrite(user)) return <Page title={x.importWizard.title} crumbs={crumbs}><EmptyState title={ta.importX.select.readOnlyTitle} hint={ta.importX.select.readOnlyHint} /></Page>;
  const { clients } = await serverApi().catalogs.uploadOptions();
  return (
    <Page title={x.importWizard.title} hint={x.importWizard.fileHint} crumbs={crumbs} wide>
      <ImportWizard clients={clients} ownCatalogue={user.clientIds === null} batchId={batch ?? null} />
    </Page>
  );
}
