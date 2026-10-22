import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { Page } from '@/ui/page';
import { AccountTab } from './account-tab';
import { DataTab } from './data-tab';
import { IntegrationsTab } from './integrations-tab';
import { LegacyHash } from './legacy-hash';
import { PlanTab } from './plan-tab';
import { SecurityTab } from './security-tab';
import { SectionNav } from './section-nav';
import { chooseTab, tabHref, visibleTabs, type SettingsTab } from './tabs';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.settingsTitle} — ${t.appName}` };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: Search }) {
  const { t, ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const params = await searchParams;
  // Team management moved to its own page; old links and bookmarks land there.
  if (params['tab'] === 'team') redirect('/team');
  // The Telegram sign-in binding comes back to /settings?tg=…: keep the result, open the tab it belongs to.
  if (typeof params['tg'] === 'string' && params['tab'] === undefined) redirect(`/settings?tab=security&tg=${encodeURIComponent(params['tg'])}`);

  const demo = user.demo;
  const visible = visibleTabs(user.role, demo);
  const { tab, refused } = chooseTab({ tab: params['tab'], tg: params['tg'] }, visible);
  const s = ta.setX;
  const label = (id: SettingsTab): string => s.tabs[id];

  return (
    <Page title={t.settingsTitle} wide>
      <LegacyHash />
      <div className="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SectionNav label={s.tabs.label} items={visible.map((id) => ({ href: tabHref(id), label: label(id), active: id === tab }))} />
        <div className="mt-6 min-w-0 max-w-4xl space-y-4 md:mt-0">
          {refused ? <p role="status" className="rounded-md border border-line bg-surface px-3 py-2 text-small text-muted">{s.adminOnly(label(refused))}</p> : null}
          {demo ? <p className="text-small text-muted">{s.demoOnly}</p> : null}
          <div>
            {tab === 'account' ? <AccountTab user={user} demo={demo} /> : null}
            {tab === 'security' ? <SecurityTab /> : null}
            {tab === 'plan' ? <PlanTab user={user} /> : null}
            {tab === 'integrations' ? <IntegrationsTab user={user} /> : null}
            {tab === 'data' ? <DataTab user={user} /> : null}
          </div>
        </div>
      </div>
    </Page>
  );
}
