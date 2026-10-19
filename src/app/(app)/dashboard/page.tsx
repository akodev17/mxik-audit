import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite, isAdminRole } from '@/lib/access';
import { activityPage } from '@/lib/activity';
import { groupDecisions } from '@/lib/activity-groups';
import { attentionReasons, rowProgress } from '@/lib/client-stats';
import { dashboard } from '@/lib/dashboard';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { onboardingSteps } from '@/lib/onboarding';
import { openTasks } from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { ActivityFeed } from '../activity/activity-feed';
import { AccountantFilter } from './accountant-filter';
import { AttentionList } from './attention-list';
import { Changes } from './changes';
import { NextStep } from './next-step';
import { Onboarding } from './onboarding';
import { TopRisk } from './top-risk';
import { TopTypes } from './top-types';
import { Tasks } from './tasks';
import { Workload } from './workload';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dash.title} — ${t.appName}` };
}

const RECENT = 8;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string }> }) {
  const { locale, ta } = await getI18n();
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
  const fmt = (n: number): string => fmtNumber(locale, n);
  const accountantQuery = data.selected ? `accountant=${encodeURIComponent(data.selected.id)}` : '';
  const queueHref = (extra = ''): string => {
    const q = [accountantQuery, extra].filter(Boolean).join('&');
    return q ? `/queue?${q}` : '/queue';
  };
  const reviewed = rowProgress(totals);
  const openSteps = steps.some((s) => !s.done);
  const firstRun = openSteps && !steps.find((s) => s.key === 'upload')?.done;
  const attention = data.clients.filter((c) => attentionReasons(c).length > 0);

  return (
    <Page title={ta.dash.title} hint={home.hint} wide>
      {user.demo ? (
        <p className="mb-5 flex flex-wrap items-center gap-2 text-small text-muted">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={home.openRows} value={fmt(totals.openRows)} href={queueHref()}
              tone={totals.openRows > 0 ? 'danger' : 'good'}
              hint={home.openRowsHint(fmt(totals.pendingFindings), totals.pendingFindings)}
            />
            <Stat
              label={ta.firmX.progress.label} href="/clients?sort=progress"
              value={reviewed ? `${fmt(reviewed.done)} / ${fmt(reviewed.total)}` : ta.firmX.dash}
              hint={reviewed ? ta.firmX.progress.of(fmt(reviewed.done), fmt(reviewed.total), reviewed.total) : ta.firmX.progress.none}
            />
            <Stat
              label={home.attention} value={fmt(totals.attention)} href="/clients?filter=attention"
              tone={totals.attention > 0 ? 'warn' : 'good'}
              hint={home.attentionHint(fmt(totals.clients), totals.clients)}
            />
            <Stat
              label={home.overdue} value={fmt(totals.overdueTasks)} href="/clients?filter=overdue"
              tone={totals.overdueTasks > 0 ? 'danger' : 'neutral'} hint={home.overdueHint}
            />
          </div>

          {firstRun ? null : <NextStep clients={data.clients} tasks={tasks} canUpload={canWrite(user) && !user.demo} queueHref={queueHref} />}

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2 [&>section]:mt-0">
            <Section title={home.attentionTitle} actions={attention.length > 0 ? <Link href="/clients?filter=attention" className="text-small font-medium text-brand-ink hover:underline">{home.attentionAll}</Link> : null}>
              <AttentionList clients={attention} />
            </Section>
            <Section title={ta.reminders.tasks}>
              <Tasks
                canWrite={canWrite(user)}
                items={tasks.map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.clientName, dueOn: x.dueOn.toISOString(), overdue: x.overdue }))}
              />
            </Section>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2 [&>section]:mt-0">
            <Section title={home.topTitle} hint={home.topHint}>
              <TopRisk clients={data.clients} accountantQuery={accountantQuery} />
            </Section>
            <Section title={home.typesTitle} hint={home.typesHint}>
              <TopTypes types={data.byType} accountantQuery={accountantQuery} />
            </Section>
          </div>

          <Section title={home.changesTitle} hint={home.changesHint}>
            <Changes changes={data.changes} />
          </Section>
        </>
      ) : null}

      {data.workload ? (
        <Section title={home.workloadTitle} hint={home.workloadHint}>
          <Workload rows={data.workload} />
        </Section>
      ) : null}

      <Section title={ta.dash.recent} actions={<Link href="/activity" className="text-small font-medium text-brand-ink hover:underline">{home.recentAll}</Link>}>
        {recent.rows.length === 0
          ? <p className="text-small text-muted">{ta.dash.recentEmpty}</p>
          : <ActivityFeed entries={groupDecisions(recent.rows).slice(0, RECENT)} />}
      </Section>

      {openSteps && !firstRun ? <div className="mt-8"><Onboarding steps={steps} primary={false} /></div> : null}
    </Page>
  );
}
