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
import { openTasks } from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { ButtonLink } from '@/ui/button';
import { ActivityFeed } from '../activity/activity-feed';
import { AccountantFilter } from './accountant-filter';
import { Changes } from './changes';
import { Onboarding } from './onboarding';
import { TopTypes } from './top-types';
import { Tasks } from './tasks';
import { Summary } from './summary';
import { WorkQueue } from './work-queue';
import { Workload } from './workload';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dash.title} — ${t.appName}` };
}

const RECENT = 8;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string }> }) {
  const { ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const admin = isAdminRole(user);
  const home = ta.firmX.home;

  const [data, allTasks, steps, recent] = await Promise.all([
    dashboard(user, admin ? sp.accountant ?? null : null),
    openTasks(user.orgId, user.clientIds),
    onboardingSteps(user),
    activityPage(user, { clientId: null, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: 40 }),
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
  // The second column exists only when it has something to say; otherwise the work gets the full width.
  const hasAside = data.byType.length > 0 || tasks.length > 0 || (openSteps && !firstRun);
  const workload = data.workload && data.workload.length > 0 ? data.workload : null;

  return (
    <Page
      title={ta.dash.title} hint={home.hint} wide
      actions={data.clients.length > 0 && canAct ? <ButtonLink href="/upload" variant="secondary" size="sm">{home.nextEmptyCta}</ButtonLink> : undefined}
    >
      {user.demo ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-small text-muted">
          <Badge tone="info">{ta.firmX.sample.badge}</Badge>
          {ta.firmX.sample.hint}
        </p>
      ) : null}

      {admin && data.accountants.length > 0 ? <AccountantFilter accountants={data.accountants} selected={data.selected} /> : null}

      {firstRun ? <div className="mb-6"><Onboarding steps={steps} primary /></div> : null}

      {data.clients.length === 0 && !firstRun ? (
        <EmptyState title={home.clientsNone} hint={home.clientsNoneHint} />
      ) : null}

      {data.clients.length > 0 ? (
        <>
          <Summary totals={totals} reviewed={reviewed} audited={audited} queueHref={queueHref()} />

          {/* Reading order on a phone: queue, issues, tasks, then history. From xl the second column holds the aside. */}
          <div className={cx('mt-6 grid grid-cols-1 gap-x-10 gap-y-8 xl:content-start xl:items-start', hasAside && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
            <WorkQueue clients={data.clients} pending={pending} canUpload={canAct} queueHref={queueHref} />

            {hasAside ? (
            <aside className="flex min-w-0 flex-col gap-8 xl:col-start-2 xl:row-span-4 xl:row-start-1 [&>section]:mt-0">
              {data.byType.length > 0 ? (
                <Section title={home.typesTitle} hint={home.typesHint}>
                  <TopTypes types={data.byType} accountantQuery={accountantQuery} />
                </Section>
              ) : null}
              {tasks.length > 0 ? (
                <Section title={ta.reminders.tasks}>
                  <Tasks
                    canWrite={canAct}
                    items={tasks.map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.clientName, dueOn: x.dueOn.toISOString(), overdue: x.overdue }))}
                  />
                </Section>
              ) : null}
              {openSteps && !firstRun ? <Onboarding steps={steps} primary={false} /> : null}
            </aside>
            ) : null}

            {data.changes.length > 0 ? (
              <Section title={home.changesTitle} hint={home.changesHint}>
                <Changes changes={data.changes} />
              </Section>
            ) : null}

            {workload ? (
              <Section title={home.workloadTitle} hint={home.workloadHint}>
                <Workload rows={workload} />
              </Section>
            ) : null}

            <Section title={ta.dash.recent} actions={<Link href="/activity" className="text-small font-medium text-brand-ink hover:underline">{home.recentAll}</Link>}>
              {recent.rows.length === 0
                ? <p className="text-small text-muted">{ta.dash.recentEmpty}</p>
                : <ActivityFeed entries={groupDecisions(recent.rows).slice(0, RECENT)} />}
            </Section>
          </div>
        </>
      ) : (
        <>
          {workload ? (
            <Section title={home.workloadTitle} hint={home.workloadHint}>
              <Workload rows={workload} />
            </Section>
          ) : null}
          {openSteps && !firstRun ? <div className="mt-8"><Onboarding steps={steps} primary={false} /></div> : null}
        </>
      )}
    </Page>
  );
}
