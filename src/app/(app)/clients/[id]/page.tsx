import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { canSeeClient, canWrite, isAdminRole } from '@/lib/access';
import { activityPage } from '@/lib/activity';
import { groupDecisions } from '@/lib/activity-groups';
import { catalogList } from '@/lib/catalogs';
import { assignableAccountants, clientDependants } from '@/lib/client-lifecycle';
import { clientStats, rowProgress } from '@/lib/client-stats';
import { db } from '@/lib/db';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { agoText, daysSince } from '@/lib/relative-day';
import { getSchedule } from '@/lib/reminders';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { IconAlert } from '@/ui/icons';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { ActivityFeed } from '../../activity/activity-feed';
import { actionText, actorText } from '../../activity/entry-text';
import { CatalogList } from '../../catalogs/catalog-list';
import { RememberClient } from '../client-forms';
import { AccountantsEditor } from './accountants-editor';
import { ActivityForm } from './activity-form';
import { ClientMenu } from './client-menu';
import { RestoreButton } from './restore-button';
import { ScheduleForm } from './schedule-form';

type Props = { params: Promise<{ id: string }> };

async function visibleClient(id: string) {
  const user = await currentUser();
  if (!user) return null;
  const client = await db.client.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, name: true, isDefault: true, archivedAt: true, activity: true },
  });
  return client && canSeeClient(user, client.id) ? { user, client } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const found = await visibleClient((await params).id);
  return { title: found ? `${found.client.name} — ${t.appName}` : t.appName };
}

const HISTORY = 10;

export default async function ClientPage({ params }: Props) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  // Another org's client id, or one outside the user's scope, is the same 404 as a missing one.
  const found = await visibleClient((await params).id);
  if (!found) notFound();
  const { client } = found;
  const words = ta.firmX.client;
  const admin = isAdminRole(user);
  const writer = canWrite(user) && !user.demo;
  const archived = client.archivedAt !== null;

  const [statsPage, catalogs, history, schedule, staff, accountants, dependants] = await Promise.all([
    clientStats({ orgId: user.orgId, clientIds: [client.id], filter: archived ? 'archived' : 'all', limit: 1 }),
    catalogList(user, client.id),
    activityPage(user, { clientId: client.id, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: 40 }),
    getSchedule(user.orgId, client.id),
    db.user.findMany({
      where: { orgId: user.orgId, role: { not: 'viewer' } }, orderBy: { email: 'asc' },
      select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } },
    }),
    admin ? assignableAccountants(user.orgId, client.id) : Promise.resolve(null),
    admin && !user.demo ? clientDependants(user.orgId, client.id) : Promise.resolve(null),
  ]);
  // Only someone who can open the client can be reminded about it; the current choice stays listed so a lost access shows.
  const people = staff
    .filter((p) => p.id === schedule?.assigneeId || p.role === 'admin' || p.assignments.length === 0 || p.assignments.some((a) => a.clientId === client.id))
    .map((p) => ({ id: p.id, email: p.email }));
  const stats = statsPage.rows[0];
  const progress = stats ? rowProgress(stats) : null;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const last = history.rows[0];
  const assigned = accountants ? accountants.filter((a) => a.assigned).map((a) => a.email) : stats?.accountants ?? [];

  return (
    <Page
      title={client.name} wide
      crumbs={[{ label: t.clientsTitle, href: '/clients' }]}
      actions={(
        <>
          {writer && !archived ? <ButtonLink href={`/upload?client=${client.id}`} variant="primary">{t.clientUpload}</ButtonLink> : null}
          {admin && !user.demo ? (
            <ClientMenu
              clientId={client.id} name={client.name} isDefault={client.isDefault} archived={archived} catalogs={stats?.catalogs ?? catalogs.total}
              blockers={dependants?.deleteBlockers ?? []} stranded={dependants?.archiveStranded ?? []}
            />
          ) : null}
        </>
      )}
    >
      {archived ? null : <RememberClient clientId={client.id} />}
      {client.isDefault ? <p className="-mt-3 mb-4"><Badge>{t.clientsDefault}</Badge>{admin ? <span className="ml-2 text-small text-muted">{words.defaultNote}</span> : null}</p> : null}

      {archived ? (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-warn-tint px-4 py-3 text-warn-ink">
          <p className="flex items-start gap-2 text-small font-medium"><IconAlert size={16} className="mt-0.5 shrink-0" />{words.archivedBanner}</p>
          {admin && !user.demo ? <RestoreButton clientId={client.id} /> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={words.kpiLastAudit}
          value={stats?.auditedAt ? agoText(ta.firmX.ago, daysSince(stats.auditedAt)) : words.noAudit}
          hint={stats?.auditedAt ? fmtDateTime(locale, stats.auditedAt) : undefined}
          href={stats?.catalogId ? `/catalogs/${stats.catalogId}` : undefined}
        />
        <Stat label={words.kpiRows} value={stats?.catalogId ? fmt(stats.rowCount) : ta.firmX.dash} />
        <Stat
          label={words.kpiOpen}
          value={stats?.catalogId ? fmt(stats.openRows) : ta.firmX.dash}
          tone={stats && stats.openRows > 0 ? 'danger' : 'neutral'}
          hint={stats?.catalogId ? words.kpiOpenHint(fmt(stats.pendingFindings), stats.pendingFindings) : undefined}
          href={stats && stats.openRows > 0 && !archived ? `/queue?client=${client.id}` : undefined}
        />
        <Stat
          label={ta.firmX.progress.label}
          value={progress ? `${fmt(progress.done)} / ${fmt(progress.total)}` : ta.firmX.dash}
          hint={progress ? ta.firmX.progress.of(fmt(progress.done), fmt(progress.total), progress.total) : stats?.catalogId ? ta.firmX.progress.none : words.noAudit}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section aria-labelledby="client-accountants" className="rounded-ctl border border-line bg-raised px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="client-accountants" className="text-small font-medium text-muted">{words.accountants}</h2>
            {accountants && !user.demo && !archived ? <AccountantsEditor clientId={client.id} people={accountants} /> : null}
          </div>
          {assigned.length === 0
            ? <p className="mt-1 text-small text-muted">{words.accountantsNone}</p>
            : <ul className="mt-1 flex flex-wrap gap-1.5">{assigned.map((email) => <li key={email}><Badge tone="brand">{email}</Badge></li>)}</ul>}
        </section>
        <section aria-labelledby="client-last" className="rounded-ctl border border-line bg-raised px-4 py-3">
          <h2 id="client-last" className="text-small font-medium text-muted">{words.lastActivity}</h2>
          {last ? (
            <p className="mt-1">
              <span className="font-medium">{actionText(last, ta, locale)}</span>
              <span className="block text-small text-muted">{actorText(last, ta)} · {fmtDateTime(locale, last.at)}</span>
            </p>
          ) : <p className="mt-1 text-small text-muted">{words.lastActivityNone}</p>}
        </section>
      </div>

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-small">
        <Link href={`/clients/${client.id}/purchases`} className="font-medium text-brand-ink hover:underline">{t.purchasesNav}</Link>
        <Link href={`/clients/${client.id}/imports`} className="font-medium text-brand-ink hover:underline">{ta.docs.title}</Link>
      </p>

      <Section title={words.settings}>
        {writer ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <ActivityForm clientId={client.id} activity={client.activity} />
            <div>
              <h3 className="mb-2 font-medium">{ta.reminders.title}</h3>
              <ScheduleForm
                clientId={client.id} people={people}
                initial={schedule ? { dayOfMonth: schedule.dayOfMonth, assigneeId: schedule.assigneeId, enabled: schedule.enabled, lastPeriod: schedule.lastPeriod } : null}
              />
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-3 text-small sm:grid-cols-2">
            <div><dt className="text-muted">{t.activityLabel}</dt><dd className="font-medium">{t.activityOptions[client.activity]}</dd></div>
            <div>
              <dt className="text-muted">{ta.reminders.title}</dt>
              <dd className="font-medium">{schedule?.enabled ? `${ta.reminders.day} ${schedule.dayOfMonth}` : ta.firmX.reminders.offNote}</dd>
            </div>
            <p className="text-muted sm:col-span-2">{user.demo ? ta.firmX.sample.hint : words.readOnly}</p>
          </dl>
        )}
      </Section>

      <Section title={t.clientCatalogs} hint={words.catalogsHint}>
        {catalogs.items.length === 0
          ? <p className="text-small text-muted">{t.clientNoCatalogs}</p>
          : <CatalogList items={catalogs.items} showClient={false} canDelete={writer} />}
        {catalogs.total > catalogs.items.length ? (
          <Link href={`/catalogs?client=${client.id}&page=2`} className="mt-2 inline-block text-small font-medium text-brand-ink hover:underline">{ta.firmX.clients.next}</Link>
        ) : null}
      </Section>

      <Section
        title={t.clientHistory} hint={words.historyHint}
        actions={<Link href={`/activity?client=${client.id}`} className="text-small font-medium text-brand-ink hover:underline">{ta.log.openAll}</Link>}
      >
        {history.rows.length === 0
          ? <p className="text-small text-muted">{t.clientHistoryEmpty}</p>
          : <ActivityFeed entries={groupDecisions(history.rows).slice(0, HISTORY)} showClient={false} />}
      </Section>
    </Page>
  );
}
