import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { groupDecisions } from '@tasnivo/domain/activity-groups';
import { openRowsHint, reviewedShare, rowProgress } from '@tasnivo/domain/client-kpi';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { apiMe } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { agoText, daysSince } from '@tasnivo/domain/relative-day';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { IconAlert, IconChevron } from '@/ui/icons';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { ActivityFeed } from '../../activity/activity-feed';
import { actionText, actorText } from '../../activity/entry-text';
import { CatalogList } from '../../catalogs/catalog-list';
import { DraftUploads } from '../../catalogs/draft-uploads';
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

export default async function ClientPage({ params }: Props) {
  const { locale, t, ta } = await getI18n();
  const id = (await params).id;
  // Another org's client id, or one outside the user's scope, is the same 404 as a missing one.
  const [user, data] = await Promise.all([apiMe(), pageData(clientPage(id))]);
  const { client, stats, catalogs, schedule, accountants, dependants } = data;
  const words = ta.firmX.client;
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

      {/* Purchases and receipts are sections of their own, so they get cards, not bare links. */}
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { href: `/clients/${client.id}/purchases`, title: t.purchasesNav, hint: words.purchasesCard },
          { href: `/clients/${client.id}/imports`, title: ta.docs.title, hint: words.docsCard },
        ].map((x) => (
          <li key={x.href}>
            <Link href={x.href} className="flex h-full items-center justify-between gap-3 rounded-ctl border border-line bg-raised px-4 py-3 transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface">
              <span className="min-w-0">
                <span className="block font-medium text-brand-ink">{x.title}</span>
                <span className="block text-small text-muted">{x.hint}</span>
              </span>
              <IconChevron size={16} className="shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>

      <Section title={words.settings}>
        {writer ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <ActivityForm clientId={client.id} activity={activity} />
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
            <div><dt className="text-muted">{t.activityLabel}</dt><dd className="font-medium">{t.activityOptions[activity]}</dd></div>
            <div>
              <dt className="text-muted">{ta.reminders.title}</dt>
              <dd className="font-medium">{schedule?.enabled ? `${ta.reminders.day} ${schedule.dayOfMonth}` : ta.firmX.reminders.offNote}</dd>
            </div>
            <p className="text-muted sm:col-span-2">{user.demo ? ta.firmX.sample.hint : words.readOnly}</p>
          </dl>
        )}
      </Section>

      <Section title={t.clientCatalogs} hint={words.catalogsHint}>
        <DraftUploads drafts={drafts} showClient={false} />
        {items.length === 0
          ? <p className="text-small text-muted">{t.clientNoCatalogs}</p>
          : <CatalogList items={items} showClient={false} canDelete={writer} />}
        {catalogs.total > items.length ? (
          <Link href={`/catalogs?client=${client.id}&page=2`} className="mt-2 inline-block text-small font-medium text-brand-ink hover:underline">{ta.firmX.clients.next}</Link>
        ) : null}
      </Section>

      <Section
        title={t.clientHistory} hint={words.historyHint}
        actions={<Link href={`/activity?client=${client.id}`} className="text-small font-medium text-brand-ink hover:underline">{ta.log.openAll}</Link>}
      >
        {history.length === 0
          ? <p className="text-small text-muted">{t.clientHistoryEmpty}</p>
          : <ActivityFeed entries={groupDecisions(history).slice(0, HISTORY)} showClient={false} />}
      </Section>
    </Page>
  );
}
