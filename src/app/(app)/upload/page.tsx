import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { UploadForm } from './upload-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.uploadTitle} — ${t.appName}` };
}

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { t } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;
  const active = await resolveClient(user.orgId, params.client ?? user.clientId);
  const [clients, org] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true } }),
    db.organization.findUnique({ where: { id: user.orgId }, select: { columnMap: true, kind: true } }),
  ]);

  return (
    <Page title={t.uploadTitle} hint={t.uploadHint}>
      {org?.kind === 'demo'
        ? <EmptyState title={t.demoUploadDisabled} />
        : <UploadForm hadPreviousMapping={org?.columnMap !== null} clients={clients} initialClientId={active.id} />}
    </Page>
  );
}
