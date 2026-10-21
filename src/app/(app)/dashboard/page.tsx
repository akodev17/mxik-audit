import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite, isAdminRole } from '@/lib/access';
import { activityPage } from '@/lib/activity';
import { groupDecisions } from '@/lib/activity-groups';
import { pendingAudits } from '@/lib/client-attention';
import { rowProgress } from '@/lib/client-stats';
import { dashboard } from '@/lib/dashboard';
import { getI18n } from '@/lib/locale';
import { onboardingSteps } from '@/lib/onboarding';
import { planStatus } from '@/lib/plan';
import { openTasks } from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { TabPanels, type TabPanel } from '@/ui/tab-panels';
import { ActivityFeed } from '../activity/activity-feed';
import { AccountantFilter } from './accountant-filter';
import { Changes } from './changes';
import { ClientRisk } from './client-risk';
import { IssueChart } from './issue-chart';
import { Onboarding } from './onboarding';
import { Summary } from './summary';
import { Tasks } from './tasks';
import { UsagePanel } from './usage-panel';
import { WorkQueue } from './work-queue';
import { Workload } from './workload';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dash.title} — ${t.appName}` };
}

const RECENT = 8;
/** Padding of every region of the page; the hairlines between regions are drawn by the grid. */
const REGION = 'px-5 py-6 sm:px-8';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string }> }) {
  const { ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const admin = isAdminRole(user);
  const home = ta.firmX.home;

  const [data, allTasks, steps, recent, plan] = await Promise.all([
    dashboard(user, admin ? sp.accountant ?? null : null),
    openTasks(user.orgId, user.clientIds),
    onboardingSteps(user),
    activityPage(user, { clientId: null, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: 40 }),
    planStatus(user.orgId),
  ]);
  const shown = new Set(data.clients.map((c) => c.id));
  const tasks = allTasks.filter((x) => shown.has(x.clientId));
  const { totals } = data;
  const accountantQuery = data.selected ? `accountant=${encodeURIComponent(data.selected.id)}` : '';
  const queueHref = (extra = ''): string => {
    const q = [accountantQuery, extra].filter(Boolean).join('&');
    return q ? `/queue?${q}` : '/queue';
  };
  const reviewed = rowProgress(totals);
  const audited = data.clients.some((c) => c.catalogId !== null);
  const openSteps = steps.some((s) => !s.done);
  const firstRun = openSteps && !steps.find((s) => s.key === 'upload')?.done;
  const pending = await pendingAudits(user.orgId, data.clients.filter((c) => !c.isDefault));
  const canAct = canWrite(user) && !user.demo;
  const workload = data.workload && data.workload.length > 0 ? data.workload : null;
  const hasClients = data.clients.length > 0;
  const capped = !user.demo && (['clients', 'rowsPerMonth', 'seats'] as const).some((k) => plan.limits[k] !== null);

  // Secondary content sits in tabs so it never competes with the work: clients, activity, changes, team.
  const tabs: TabPanel[] = [
    { id: 'clients', label: ta.nav.clients, content: <ClientRisk clients={data.clients} accountantQuery={accountantQuery} /> },
    {
      id: 'activity', label: ta.nav.activity,
      content: (
        <>
          {recent.rows.length === 0
            ? <p className="text-small text-muted">{ta.dash.recentEmpty}</p>
            : <ActivityFeed entries={groupDecisions(recent.rows).slice(0, RECENT)} />}
          <Link href="/activity" className="mt-3 inline-block text-small font-medium text-brand-ink hover:underline">{home.recentAll}</Link>
        </>
      ),
    },
    ...(data.changes.length > 0 ? [{ id: 'changes', label: home.changesTitle, content: <Changes changes={data.changes} /> }] : []),
    ...(workload ? [{ id: 'workload', label: home.workloadTitle, content: <Workload rows={workload} /> }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-[100rem]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pb-6 pt-8 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[2.25rem] font-normal leading-10 tracking-tight">{ta.dash.title}</h1>
          <p className="mt-1.5 max-w-2xl text-small text-muted">{home.hint}</p>
          {user.demo ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-small text-muted">
              <Badge tone="info">{ta.firmX.sample.badge}</Badge>
              {ta.firmX.sample.hint}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin && data.accountants.length > 0 ? <AccountantFilter accountants={data.accountants} selected={data.selected} /> : null}
          {hasClients && canAct ? <ButtonLink href="/upload" variant="secondary">{home.nextEmptyCta}</ButtonLink> : null}
        </div>
      </div>

      {firstRun ? <div className="border-t border-line px-5 py-6 sm:px-8"><Onboarding steps={steps} primary /></div> : null}

      {!hasClients && !firstRun ? (
        <div className="border-t border-line px-5 py-6 sm:px-8"><EmptyState title={home.clientsNone} hint={home.clientsNoneHint} /></div>
      ) : null}

      {hasClients ? (
        <div className="grid border-t border-line xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 xl:border-r xl:border-line">
            <div className={`${REGION} border-b border-line`}>
              <Summary totals={totals} reviewed={reviewed} audited={audited} queueHref={queueHref()} />
            </div>
            {data.byType.length > 0 ? (
              <div className={`${REGION} border-b border-line`}><IssueChart types={data.byType} accountantQuery={accountantQuery} /></div>
            ) : null}
            <div className={`${REGION} max-xl:border-b max-xl:border-line`}><TabPanels label={ta.dash.recent} tabs={tabs} /></div>
          </div>

          <aside className="min-w-0 divide-y divide-line">
            <div className={REGION}>
              <WorkQueue clients={data.clients} pending={pending} canUpload={canAct} queueHref={queueHref} />
            </div>
            {tasks.length > 0 ? (
              <div className={REGION}>
                <h2 className="mb-4 text-[1.125rem] font-medium leading-6">{ta.reminders.tasks}</h2>
                <Tasks
                  canWrite={canAct}
                  items={tasks.map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.clientName, dueOn: x.dueOn.toISOString(), overdue: x.overdue }))}
                />
              </div>
            ) : null}
            {capped ? <div className={REGION}><UsagePanel status={plan} /></div> : null}
            {openSteps && !firstRun ? <div className={REGION}><Onboarding steps={steps} primary={false} /></div> : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
