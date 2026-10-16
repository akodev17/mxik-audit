import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listCatalogs } from '@/lib/catalogs';
import { clientScope } from '@/lib/access';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { CatalogTable } from '@/ui/catalog-table';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { DeleteCatalogButton } from './delete-button';

export const metadata: Metadata = { title: `${t.catalogsTitle} — ${t.appName}` };

export default async function CatalogsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const [catalogs, clients] = await Promise.all([
    listCatalogs(user.orgId, null, user.clientIds),
    db.client.findMany({ where: { orgId: user.orgId, ...clientScope(user) }, select: { id: true, name: true } }),
  ]);
  const names = clients.length > 1 ? new Map(clients.map((c) => [c.id, c.name])) : undefined;

  return (
    <Page
      title={t.catalogsTitle} hint={t.catalogsHint} wide
      actions={user.demo ? null : <ButtonLink href="/upload" variant="primary">{ta.catalogs.uploadCta}</ButtonLink>}
    >
      {catalogs.length === 0 ? (
        <EmptyState
          title={ta.catalogs.emptyTitle} hint={ta.catalogs.emptyHint}
          action={<ButtonLink href="/upload" variant="primary">{ta.catalogs.uploadCta}</ButtonLink>}
        />
      ) : (
        <CatalogTable
          catalogs={catalogs} clientNames={names}
          rowAction={user.demo ? undefined : (c) => <DeleteCatalogButton catalogId={c.id} filename={c.filename} />}
        />
      )}
    </Page>
  );
}
