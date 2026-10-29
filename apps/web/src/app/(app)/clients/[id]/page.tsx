import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { canWrite, isAdminRole } from '@/lib/pure/access';
import { groupDecisions } from '@/lib/pure/activity-groups';
import { openRowsHint, reviewedShare, rowProgress } from '@/lib/pure/client-kpi';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { signedIn } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { agoText, daysSince } from '@/lib/pure/relative-day';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconBell, IconChevron, IconTable, IconUpload } from '@/ui/icons';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { ActivityFeed } from '../../activity/activity-feed';
import { actionText, actorText } from '../../activity/entry-text';
import { CatalogList } from '../../catalogs/catalog-list';
import { DraftUploads } from '../../catalogs/draft-uploads';
import { PersonChip } from '../../_manage/avatar';
import { Card } from '../../_manage/card';
import { Notice } from '../../_manage/notice';
import { RememberClient } from '../client-forms';
import { AccountantsEditor } from './accountants-editor';
import { ActivityForm } from './activity-form';
import { ClientMenu } from './client-menu';
import { RestoreButton } from './restore-button';
import { ScheduleForm } from './schedule-form';

type Props = { params: Promise<{ id: string }> };

/** The page's data, read once per request (the title shares it); 404 when the user may not see the client. */
const clientPage = cache((clientId: string) => serverApi().clients.get({ clientId }));

/** A client the user may not see reads like any missing page, never its name. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const found = await clientPage((await params).id).catch((error: unknown) => {
    if (isApiError(error) && error.status >= 400 && error.status < 500) return null;
    throw error;
  });
  return { title: `${found ? found.client.name : ta.shellX.notFound.title} — ${t.appName}` };
}

const HISTORY = 10;

/** One fact of the header line: a muted label and its value. */
function Meta({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {icon ? <span aria-hidden className="shrink-0 text-subtle">{icon}</span> : null}
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 text-small text-muted">{children}</dd>
    </div>
  );
}

export default async function ClientPage({ params }: Props) {
  const { locale, t, ta } = await getI18n();
  const id = (await params).id;
  // Another org's client id, or one outside the user's scope, is the same 404 as a missing one.
  const [user, data] = await Promise.all([signedIn(), pageData(clientPage(id))]);
  if (!user) redirect('/sign-in');
  const { client, stats, catalogs, schedule, accountants, dependants } = data;
  const words = ta.firmX.client;
  const mg = ta.mgX.clients;
  const admin = isAdminRole(user);
  const writer = canWrite(user) && !user.demo;
  const archived = client.archivedAt !== null;
  const activity = client.activity ?? 'boshqa';

  // The API lists only people who can open the client, plus the current choice so a lost access shows.
  const people = data.staff.map((p) => ({ id: p.id, email: p.email }));
  // The shared list and feed components work with dates; the API sends ISO strings.
  const items = catalogs.items.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }));
  const drafts = data.drafts.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }));
  const history = data.history.rows.map((r) => ({ ...r, at: new Date(r.at) }));
  const progress = stats ? rowProgress(stats) : null;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const last = history[0];
  const assigned = accountants ? accountants.filter((a) => a.assigned).map((a) => a.email) : stats?.accountants ?? [];
  const lists = [
    { href: `/clients/${client.id}/purchases`, title: t.purchasesNav, hint: words.purchasesCard },
    { href: `/clients/${client.id}/imports`, title: ta.docs.title, hint: words.docsCard },
  ];

  return (
    <Page
      title={client.name} wide
      crumbs={[{ label: t.clientsTitle, href: '/clients' }]}
      actions={(
        <>
          {writer && !archived ? <ButtonLink href={`/upload?client=${client.id}`} variant="primary"><IconUpload size={16} />{t.clientUpload}</ButtonLink> : null}
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

      {/* The header line under the name: what kind of business, when it is checked, who works on it. */}
      <div className="-mt-2 mb-6 space-y-3">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {client.isDefault ? (
            <div className="flex items-center gap-2">
              <dt className="sr-only">{t.clientsDefault}</dt>
              <dd><Badge tone="brand">{t.clientsDefault}</Badge>{admin ? <span className="ml-2 text-small text-muted">{words.defaultNote}</span> : null}</dd>
            </div>
          ) : null}
          <Meta label={t.activityLabel} icon={<IconTable size={16} />}><span aria-hidden>{t.activityLabel}: </span><span className="font-medium text-fg">{t.activityOptions[activity]}</span></Meta>
          <Meta label={ta.reminders.title} icon={<IconBell size={16} />}>
            {schedule?.enabled ? mg.scheduleOn(schedule.dayOfMonth) : mg.scheduleOff}
          </Meta>
        </dl>
        <section aria-labelledby="client-accountants" className="relative flex flex-wrap items-center gap-2">
          <h2 id="client-accountants" className="sr-only">{words.accountants}</h2>
          {assigned.length === 0
            ? <p className="text-small text-muted">{words.accountantsNone}</p>
            : <ul className="flex flex-wrap gap-1.5">{assigned.map((email) => <li key={email} className="min-w-0 max-w-full"><PersonChip email={email} /></li>)}</ul>}
          {accountants && !user.demo && !archived ? <AccountantsEditor clientId={client.id} people={accountants} /> : null}
        </section>
      </div>

      {archived ? (
        <Notice tone="warn" className="mb-5" action={admin && !user.demo ? <RestoreButton clientId={client.id} /> : undefined}>
          <span className="font-medium">{words.archivedBanner}</span>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={words.kpiLastAudit}
          value={stats?.auditedAt ? agoText(ta.firmX.ago, daysSince(new Date(stats.auditedAt))) : words.noAudit}
          hint={stats?.auditedAt ? fmtDateTime(locale, stats.auditedAt) : undefined}
          href={stats?.catalogId ? `/catalogs/${stats.catalogId}` : undefined}
        />
        <Stat label={words.kpiRows} value={stats?.catalogId ? fmt(stats.rowCount) : ta.firmX.dash} />
        <Stat
          label={words.kpiOpen}
          value={stats?.catalogId ? fmt(stats.openRows) : ta.firmX.dash}
          tone={stats && stats.openRows > 0 ? 'danger' : 'neutral'}
          hint={stats?.catalogId ? openRowsHint(locale, ta.firmX.progress, stats.openRows, stats.pendingFindings) : undefined}
          href={stats && stats.openRows > 0 && !archived ? `/queue?client=${client.id}` : undefined}
        />
        <Stat
          label={ta.firmX.progress.label}
          value={progress ? `${fmt(progress.done)} / ${fmt(progress.total)}` : ta.firmX.dash}
          hint={progress ? reviewedShare(locale, ta.firmX.progress, progress) : stats?.catalogId ? ta.firmX.progress.none : words.noAudit}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {/* The catalogue list draws its own frame, so this block is a titled section rather than a card around it. */}
          <Section
            title={t.clientCatalogs} hint={words.catalogsHint}
            actions={catalogs.total > items.length ? <Link href={`/catalogs?client=${client.id}&page=2`} className="text-small font-medium text-brand-ink hover:underline">{ta.firmX.clients.next}</Link> : undefined}
          >
            <DraftUploads drafts={drafts} showClient={false} />
            {items.length === 0 ? (
              <Card>
                <EmptyState
                  size="compact" as="h3" icon={<IconTable size={22} />} title={mg.catalogsEmpty} hint={drafts.length === 0 ? mg.catalogsEmptyHint : t.clientNoCatalogs}
                  action={writer && !archived ? <ButtonLink href={`/upload?client=${client.id}`} variant="secondary"><IconUpload size={16} />{t.clientUpload}</ButtonLink> : undefined}
                />
              </Card>
            ) : <CatalogList items={items} showClient={false} canDelete={admin && !user.demo} />}
          </Section>

          <Card
            id="client-history" title={t.clientHistory} hint={words.historyHint}
            actions={<Link href={`/activity?client=${client.id}`} className="text-small font-medium text-brand-ink hover:underline">{ta.log.openAll}</Link>}
          >
            {history.length === 0
              ? <EmptyState size="compact" as="h3" title={mg.activityEmpty} hint={t.clientHistoryEmpty} />
              : <ActivityFeed entries={groupDecisions(history).slice(0, HISTORY)} showClient={false} />}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title={words.lastActivity} as="h2">
            {last ? (
              <p>
                <span className="font-medium">{actionText(last, ta, locale)}</span>
                <span className="mt-0.5 block text-small text-muted">{actorText(last, ta)} · {fmtDateTime(locale, last.at)}</span>
              </p>
            ) : <p className="text-small text-muted">{words.lastActivityNone}</p>}
          </Card>

          {/* Purchases and receipts are sections of their own: one card with a row each. */}
          <Card title={mg.lists} flush>
            <ul className="divide-y divide-line">
              {lists.map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-surface sm:px-5">
                    <span className="min-w-0">
                      <span className="block font-medium text-brand-ink">{x.title}</span>
                      <span className="block text-small text-muted">{x.hint}</span>
                    </span>
                    <IconChevron size={16} className="shrink-0 text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {writer ? (
            <>
              <h2 className="sr-only">{words.settings}</h2>
              <ActivityForm clientId={client.id} activity={activity} />
              <ScheduleForm
                clientId={client.id} people={people}
                initial={schedule ? { dayOfMonth: schedule.dayOfMonth, assigneeId: schedule.assigneeId, enabled: schedule.enabled, lastPeriod: schedule.lastPeriod } : null}
              />
            </>
          ) : (
            <Card title={words.settings}>
              <dl className="grid grid-cols-1 gap-3 text-small">
                <div><dt className="text-muted">{t.activityLabel}</dt><dd className="font-medium">{t.activityOptions[activity]}</dd></div>
                <div>
                  <dt className="text-muted">{ta.reminders.title}</dt>
                  <dd className="font-medium">{schedule?.enabled ? `${ta.reminders.day} ${schedule.dayOfMonth}` : ta.firmX.reminders.offNote}</dd>
                </div>
              </dl>
              <p className="mt-3 text-small text-muted">{user.demo ? ta.firmX.sample.hint : words.readOnly}</p>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
