import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { getI18n } from '@/lib/locale';
import { groupDecisions } from '@/lib/pure/activity-groups';
import { rowProgress } from '@/lib/pure/client-kpi';
import { parseQueueParams, workQueue, type QueueFilter, type QueueSort } from '@/lib/pure/work-queue';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { IconChevron } from '@/ui/icons';
import { Page } from '@/ui/page';
import { TabPanels, type TabPanel } from '@/ui/tab-panels';
import { ActivityFeed } from '../activity/activity-feed';
import { AccountantFilter } from './accountant-filter';
import { Card, FOOT_LINK } from './card';
import { Changes } from './changes';
import { dashboardData } from './dashboard-data';
import { IssueChart } from './issue-chart';
import { Onboarding } from './onboarding';
import { ONBOARDING_COOKIE, onboardingHidden } from './onboarding-pref';
import { RestoreOnboarding } from './onboarding-toggle';
import { Summary } from './summary';
import { ReviewTasks } from './review-tasks';
import { Tasks } from './tasks';
import { UsagePanel } from './usage-panel';
import { WorkQueue } from './work-queue';
import { Workload } from './workload';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dash.title} — ${t.appName}` };
}

const RECENT = 8;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string; qf?: string; qs?: string; rv?: string }> }) {
  const { ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const admin = user.role === 'admin';
  const home = ta.firmX.home;
  const view = parseQueueParams(sp);

  const mineOnly = sp.rv === 'mine';
  const [{ data, plan }, jar] = await Promise.all([dashboardData(sp), cookies()]);
  const { tasks, onboarding: steps, reviews: { open: reviews, counts: reviewTotals } } = data;
  const { totals } = data;
  const accountantQuery = data.selected ? `accountant=${encodeURIComponent(data.selected.id)}` : '';
  const queueHref = (extra = ''): string => {
    const q = [accountantQuery, extra].filter(Boolean).join('&');
    return q ? `/queue?${q}` : '/queue';
  };
  const reviewed = rowProgress(totals);
  const awaiting = data.clients.filter((c) => c.openRows > 0).length;
  const viewHref = (v: { qf?: QueueFilter; qs?: QueueSort }): string => {
    const q = new URLSearchParams();
    if (data.selected) q.set('accountant', data.selected.id);
    if (v.qf && v.qf !== 'all') q.set('qf', v.qf);
    if (v.qs && v.qs !== 'urgent') q.set('qs', v.qs);
    if (mineOnly) q.set('rv', 'mine');
    const text = q.toString();
    return text ? `/dashboard?${text}` : '/dashboard';
  };
  const reviewHref = (mine: boolean): string => {
    const q = new URLSearchParams();
    if (data.selected) q.set('accountant', data.selected.id);
    if (view.filter !== 'all') q.set('qf', view.filter);
    if (view.sort !== 'urgent') q.set('qs', view.sort);
    if (mine) q.set('rv', 'mine');
    const text = q.toString();
    return text ? `/dashboard?${text}` : '/dashboard';
  };
  const audited = data.clients.some((c) => c.catalogId !== null);
  const openSteps = steps.some((s) => !s.done);
  const firstRun = openSteps && !steps.find((s) => s.key === 'upload')?.done;
  const checklistHidden = onboardingHidden(jar.get(ONBOARDING_COOKIE)?.value);
  const canAct = user.role !== 'viewer' && !user.demo;
  const workload = data.workload && data.workload.length > 0 ? data.workload : null;
  const hasClients = data.clients.length > 0;
  const capped = !user.demo && (['clients', 'rowsPerMonth', 'seats'] as const).some((k) => plan.limits[k] !== null);
  // A brand-new firm sees the checklist alone: an empty queue and an empty log would only repeat "nothing yet".
  const showQueue = !firstRun || workQueue(data.clients, new Set(data.pending.keys())).length > 0;
  const showRecent = !firstRun || data.activity.length > 0;
  const stepsDone = ta.firmX.onboarding.progress(steps.filter((s) => s.done).length, steps.length);

  // Secondary content shares one card in tabs, so it never competes with the work: activity, changes, team.
  const tabs: TabPanel[] = [
    {
      id: 'activity', label: ta.nav.activity,
      content: data.activity.length === 0
        ? <p className="py-4 text-small text-muted">{ta.dash.recentEmpty}</p>
        : <ActivityFeed entries={groupDecisions(data.activity).slice(0, RECENT)} />,
    },
    ...(data.changes.length > 0 ? [{ id: 'changes', label: home.changesTitle, content: <><p className="mb-3 text-small text-muted">{home.changesHint}</p><Changes changes={data.changes} /></> }] : []),
    ...(workload ? [{ id: 'workload', label: home.workloadTitle, content: <><p className="mb-3 text-small text-muted">{home.workloadHint}</p><Workload rows={workload} /></> }] : []),
  ];

  return (
    <Page
      title={ta.dash.title}
      hint={home.hint}
      wide
      actions={admin && data.accountants.length > 0 ? <AccountantFilter accountants={data.accountants} selected={data.selected} /> : null}
    >
      {user.demo ? (
        <p className="-mt-2 mb-5 flex flex-wrap items-center gap-2 text-small text-muted">
          <Badge tone="info">{ta.firmX.sample.badge}</Badge>
          {ta.firmX.sample.hint}
        </p>
      ) : null}

      <div className="space-y-6">
        {firstRun ? <Onboarding steps={steps} primary /> : null}

        {!hasClients && !firstRun ? (
          <div className="rounded-lg border border-line bg-raised"><EmptyState title={home.clientsNone} hint={home.clientsNoneHint} /></div>
        ) : null}

        {hasClients ? (
          <>
            {audited ? <Summary totals={totals} reviewed={reviewed} audited={audited} queueHref={queueHref()} awaiting={awaiting} changes={data.changes} /> : null}

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="min-w-0 space-y-6">
                {showQueue ? <WorkQueue clients={data.clients} pending={data.pending} canUpload={canAct} queueHref={queueHref} filter={view.filter} sort={view.sort} viewHref={viewHref} /> : null}
                {showRecent ? <Card
                  id="recent"
                  title={ta.dash.recent}
                  footer={<Link href="/activity" className={FOOT_LINK}>{home.recentAll}<IconChevron size={12} /></Link>}
                >
                  {tabs.length > 1 ? <TabPanels label={ta.dash.recent} tabs={tabs} /> : tabs[0]?.content}
                </Card> : null}
              </div>

              <div className="min-w-0 space-y-6">
                {openSteps && !firstRun && !checklistHidden ? <Onboarding steps={steps} primary={false} /> : null}
                {reviewTotals.open > 0 ? <ReviewTasks items={reviews} counts={reviewTotals} mineOnly={mineOnly} viewHref={reviewHref} /> : null}
                {tasks.length > 0 ? (
                  <Card id="tasks" title={ta.reminders.tasks} flush>
                    <Tasks
                      canWrite={canAct}
                      items={tasks.map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.clientName, dueOn: x.dueOn, overdue: x.overdue }))}
                    />
                  </Card>
                ) : null}
                {data.byType.length > 0 ? <IssueChart types={data.byType} accountantQuery={accountantQuery} /> : null}
                {capped ? <UsagePanel status={plan} /> : null}
                {openSteps && !firstRun && checklistHidden ? <RestoreOnboarding>{ta.firmX.onboarding.restore(stepsDone)}<IconChevron size={12} /></RestoreOnboarding> : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Page>
  );
}
