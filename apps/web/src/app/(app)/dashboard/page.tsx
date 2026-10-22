import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { activityPage } from '@tasnivo/domain/activity';
import { groupDecisions } from '@tasnivo/domain/activity-groups';
import { rowProgress } from '@tasnivo/domain/client-stats';
import { parseQueueParams, type QueueFilter, type QueueSort } from '@tasnivo/domain/work-queue';
import { dashboard } from '@tasnivo/domain/dashboard';
import { getI18n } from '@/lib/locale';
import { onboardingSteps } from '@tasnivo/domain/onboarding';
import { planStatus } from '@/lib/plan';
import { openTasks } from '@tasnivo/domain/reminders';
import { openReviews, reviewCounts } from '@tasnivo/domain/review-assignments';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { TabPanels, type TabPanel } from '@/ui/tab-panels';
import { ActivityFeed } from '../activity/activity-feed';
import { AccountantFilter } from './accountant-filter';
import { Changes } from './changes';
import { IssueChart } from './issue-chart';
import { Onboarding } from './onboarding';
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
/** Padding of every region of the page; the hairlines between regions are drawn by the grid. */
const REGION = 'px-5 py-6 sm:px-8';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string; qf?: string; qs?: string; rv?: string }> }) {
  const { ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const admin = isAdminRole(user);
  const home = ta.firmX.home;
  const view = parseQueueParams(sp);

  const mineOnly = sp.rv === 'mine';
  const [data, allTasks, steps, recent, plan, reviews, reviewTotals] = await Promise.all([
    dashboard(user, admin ? sp.accountant ?? null : null),
    openTasks(user.orgId, user.clientIds),
    onboardingSteps(user),
    activityPage(user, { clientId: null, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: 40 }),
    planStatus(user.orgId),
    openReviews(user, { mineOnly }),
    reviewCounts(user),
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
  const canAct = canWrite(user) && !user.demo;
  const workload = data.workload && data.workload.length > 0 ? data.workload : null;
  const hasClients = data.clients.length > 0;
  const capped = !user.demo && (['clients', 'rowsPerMonth', 'seats'] as const).some((k) => plan.limits[k] !== null);

  // Secondary content sits in tabs so it never competes with the work: clients, activity, changes, team.
  const tabs: TabPanel[] = [
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
          <h1 className="text-[2rem] font-normal leading-9 tracking-tight">{ta.dash.title}</h1>
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
        </div>
      </div>

      {firstRun ? <div className="border-t border-line px-5 py-6 sm:px-8"><Onboarding steps={steps} primary /></div> : null}

      {!hasClients && !firstRun ? (
        <div className="border-t border-line px-5 py-6 sm:px-8"><EmptyState title={home.clientsNone} hint={home.clientsNoneHint} /></div>
      ) : null}

      {hasClients ? (
        <>
        <div className="grid border-t border-line xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="min-w-0 divide-y divide-line xl:border-r xl:border-line">
            <div className={REGION}>
              <Summary totals={totals} reviewed={reviewed} audited={audited} queueHref={queueHref()} awaiting={awaiting} />
            </div>
            <div className={REGION}>
              <WorkQueue clients={data.clients} pending={data.pending} canUpload={canAct} queueHref={queueHref} filter={view.filter} sort={view.sort} viewHref={viewHref} />
            </div>
          </div>

          <aside className="min-w-0 divide-y divide-line max-xl:border-t max-xl:border-line">
            {data.byType.length > 0 ? <div className={REGION}><IssueChart types={data.byType} accountantQuery={accountantQuery} /></div> : null}
            {reviewTotals.open > 0 ? <div className={REGION}><ReviewTasks items={reviews} counts={reviewTotals} mineOnly={mineOnly} viewHref={reviewHref} /></div> : null}
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
        <div className={`${REGION} border-t border-line`}>
          {tabs.length > 1 ? <TabPanels label={ta.dash.recent} tabs={tabs} /> : (
              <section aria-labelledby="recent-title">
                <h2 id="recent-title" className="mb-3 text-[1.125rem] font-medium leading-6">{ta.dash.recent}</h2>
                {tabs[0]?.content}
              </section>
            )}
        </div>
        </>
      ) : null}
    </div>
  );
}
