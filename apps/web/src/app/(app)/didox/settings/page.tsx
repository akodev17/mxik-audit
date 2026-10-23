// The org's Didox connection (admin only; a demo org may look but not save). "Paste your token"
// is the working path; ИНН + password sits behind DIDOX_PASSWORD_LOGIN; E-IMZO is not implemented.
import type { Metadata } from 'next';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { isAdminRole } from '@/lib/pure/access';
import { Alert } from '@/ui/alert';
import { Page } from '@/ui/page';
import { Notice } from '../../_manage/notice';
import { ConnectionForm } from './connection-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.didoxX.settings.title} — ${t.appName}` };
}

export default async function DidoxSettingsPage() {
  const { ta } = await getI18n();
  const s = ta.didoxX.settings;
  const api = serverApi();
  const user = await pageData(api.auth.me());
  const crumbs = [{ label: ta.didoxX.title, href: '/didox' }];
  if (!isAdminRole(user)) {
    return (
      <Page title={s.title} crumbs={crumbs}>
        <Notice tone="info">{s.adminOnly}</Notice>
      </Page>
    );
  }
  const [connection, options] = await Promise.all([pageData(api.didox.connection()), pageData(api.catalogs.uploadOptions())]);
  return (
    <Page title={s.title} hint={s.hint} crumbs={crumbs}>
      <div className="space-y-6">
        <Alert tone="info">{ta.didoxX.unverified}</Alert>
        <ConnectionForm connection={connection} clients={options.clients} demo={user.demo} />
        <Notice tone="info">{s.eimzo}</Notice>
      </div>
    </Page>
  );
}
