import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listCatalogs } from '@/lib/catalogs';
import { clientHistory, ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { canSeeClient } from '@/lib/access';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { CatalogTable } from '@/ui/catalog-table';
import { Page, Section } from '@/ui/page';
import { RememberClient } from '../client-forms';
import { ActivityForm } from './activity-form';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  // Another org's client id is the same 404 as a missing one.
  const client = await ownedClient(user.orgId, id);
  if (!client || !canSeeClient(user, client.id)) notFound();

  const [catalogs, history] = await Promise.all([
    listCatalogs(user.orgId, client.id),
    clientHistory(user.orgId, client.id),
  ]);
  const { activity } = await db.client.findUniqueOrThrow({ where: { id: client.id }, select: { activity: true } });

  return (
    <Page
      title={client.name} wide
      actions={user.demo ? null : <ButtonLink href={`/upload?client=${client.id}`} variant="primary">{t.clientUpload}</ButtonLink>}
    >
      <RememberClient clientId={client.id} />
      <p className="-mt-3 mb-5 text-sm"><Link href="/clients" className="text-brand hover:underline">{t.clientsTitle}</Link></p>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-ctl bg-surface px-4 py-3">
        {!user.demo ? <ActivityForm clientId={client.id} activity={activity} /> : <span />}
        <Link href={`/clients/${client.id}/purchases`} className="text-sm font-medium text-brand hover:underline">{t.purchasesNav}</Link>
      </div>

      <Section title={t.clientCatalogs}>
        {catalogs.length === 0 ? <p className="text-sm text-muted">{t.clientNoCatalogs}</p> : <CatalogTable catalogs={catalogs} />}
      </Section>

      <Section title={t.clientHistory}>
        <Link href={`/activity?client=${client.id}`} className="-mt-2 mb-3 inline-block text-sm text-brand hover:underline">{ta.log.openAll}</Link>
        {history.length === 0 ? (
          <p className="text-sm text-muted">{t.clientHistoryEmpty}</p>
        ) : (
          <ol className="divide-y divide-line rounded-ctl border border-line">
            {history.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 text-sm">
                <span>
                  <span className="font-medium">{t.historyAction[e.action] ?? e.action}</span>
                  {typeof e.payload['filename'] === 'string' ? <span className="ml-2 text-muted">{e.payload['filename']}</span> : null}
                  {typeof e.payload['summary'] === 'string' ? <span className="ml-2 text-muted">{e.payload['summary']}</span> : null}
                </span>
                <span className="text-xs text-muted">{e.createdAt.toLocaleString('uz-UZ')}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Page>
  );
}
