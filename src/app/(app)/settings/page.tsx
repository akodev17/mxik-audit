import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isDemoOrg } from '@/lib/demo';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { Page } from '@/ui/page';
import { Tabs } from '@/ui/tabs';
import { AccountTab } from './account-tab';
import { DataTab } from './data-tab';
import { IntegrationsTab } from './integrations-tab';
import { LegacyHash } from './legacy-hash';
import { PlanTab } from './plan-tab';
import { SecurityTab } from './security-tab';
import { TabStrip } from './tab-strip';
import { chooseTab, tabHref, visibleTabs, type SettingsTab } from './tabs';
import { TeamTab } from './team-tab';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.settingsTitle} — ${t.appName}` };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: Search }) {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;
  // The Telegram sign-in binding comes back to /settings?tg=…: keep the result, open the tab it belongs to.
  if (typeof params['tg'] === 'string' && params['tab'] === undefined) redirect(`/settings?tab=security&tg=${encodeURIComponent(params['tg'])}`);

  const demo = await isDemoOrg(user.orgId);
  const visible = visibleTabs(user.role, demo);
  const { tab, refused } = chooseTab({ tab: params['tab'], tg: params['tg'] }, visible);
  const s = ta.setX;
  const label = (id: SettingsTab): string => s.tabs[id];

  return (
    <Page title={t.settingsTitle}>
      <LegacyHash />
      <TabStrip label={s.tabs.label}>
        <Tabs items={visible.map((id) => ({ href: tabHref(id), label: label(id), active: id === tab }))} />
      </TabStrip>
      {refused ? <p role="status" className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-small text-muted">{s.adminOnly(label(refused))}</p> : null}
      {demo ? <p className="mt-4 text-small text-muted">{s.demoOnly}</p> : null}
      <div className="mt-6">
        {tab === 'account' ? <AccountTab user={user} demo={demo} /> : null}
        {tab === 'security' ? <SecurityTab user={user} /> : null}
        {tab === 'team' ? <TeamTab user={user} /> : null}
        {tab === 'plan' ? <PlanTab user={user} demo={demo} /> : null}
        {tab === 'integrations' ? <IntegrationsTab user={user} /> : null}
        {tab === 'data' ? <DataTab user={user} /> : null}
      </div>
    </Page>
  );
}
