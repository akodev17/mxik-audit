// /onec/settings: the org's 1C settings and connection (admins) and its counterparties (everyone
// may look them up; writers load a 1C «Контрагенты» file).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite, isAdminRole } from '@/lib/pure/access';
import { Alert } from '@/ui/alert';
import { Page } from '@/ui/page';
import { ConnectionForm } from './connection-form';
import { CounterpartiesPanel } from './counterparties-panel';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.onecX.settings.title} — ${t.appName}` };
}

export default async function OnecSettingsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const s = ta.onecX.settings;
  const admin = isAdminRole(user);
  const [connection, options] = await Promise.all([
    admin ? pageData(serverApi().onec.connection()) : Promise.resolve(null),
    pageData(serverApi().catalogs.uploadOptions()),
  ]);
  const initialClient = options.clients.find((c) => c.id === sp.client)?.id ?? user.clientId ?? null;

  return (
    <Page title={s.title} hint={s.hint} crumbs={[{ label: ta.accountingX.nav.onec, href: '/onec' }]}>
      <div className="space-y-6">
        {connection ? <ConnectionForm initial={connection} demo={user.demo} /> : <Alert tone="info">{s.adminOnly}</Alert>}
        <CounterpartiesPanel clients={options.clients} initialClient={initialClient} canImport={canWrite(user) && !user.demo} />
      </div>
    </Page>
  );
}
