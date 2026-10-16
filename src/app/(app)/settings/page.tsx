import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { billingConfig } from '@/lib/billing/config';
import { firmPlan } from '@/lib/billing/plans';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { currentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { listLinks } from '@/lib/telegram/linking';
import { Page, Section } from '@/ui/page';
import { PayButtons } from '@/ui/pay-buttons';
import { isAdminRole } from '@/lib/access';
import { mailEnabled } from '@/lib/mailer';
import { BrandForm } from './brand-form';
import { planStatus } from '@/lib/plan';
import { DictionarySetting } from './dictionary-setting';
import { PlanUsage } from './plan-usage';
import { TeamPanel } from './team-panel';
import { TelegramPanel } from './telegram-panel';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.settingsTitle} — ${t.appName}` };
}

export default async function SettingsPage() {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const tg = telegramConfig();
  const status = await planStatus(user.orgId);
  const [demo, links, org, team, clients, invites] = await Promise.all([
    isDemoOrg(user.orgId),
    listLinks(user.orgId),
    db.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { name: true, brandName: true, logoData: true, logoMime: true, subscriptionUntil: true, dictAutoAccept: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } } }),
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.invite.findMany({ where: { orgId: user.orgId, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, expiresAt: true } }),
  ]);
  // The firm plan shows only once its price is set and a provider is configured.
  const billing = billingConfig();
  const plan = firmPlan();
  const providers = [billing.click ? 'click' as const : null, billing.payme ? 'payme' as const : null]
    .filter((x): x is 'click' | 'payme' => x !== null);
  const active = org.subscriptionUntil && org.subscriptionUntil > new Date() ? org.subscriptionUntil : null;
  const logoUrl = org.logoData && org.logoMime ? `data:${org.logoMime};base64,${Buffer.from(org.logoData).toString('base64')}` : null;

  return (
    <Page title={t.settingsTitle}>
      {!demo && isAdminRole(user) ? (
        <Section title={t.brandSection} hint={t.brandHint}>
          <BrandForm brandName={org.brandName ?? ''} orgName={org.name} logoUrl={logoUrl} />
        </Section>
      ) : null}

      {!demo && isAdminRole(user) ? (
        <Section title={ta.dict.autoTitle}>
          <DictionarySetting initial={org.dictAutoAccept} />
        </Section>
      ) : null}

      <Section title={t.tgSection}>
        {!tg.enabled ? (
          <p className="text-sm text-muted">{t.tgOff}</p>
        ) : demo ? (
          <p className="text-sm text-muted">{t.tgDemoOff}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{t.tgIntro(tg.username)}</p>
            <TelegramPanel chats={links.map((l) => ({ id: l.id, username: l.username, linkedAt: l.createdAt.toLocaleDateString('uz-UZ') }))} />
          </>
        )}
      </Section>

      <Section title={ta.settings.plan}>
        <div id="plan" className="mb-4"><PlanUsage status={status} until={active ? active.toLocaleDateString('uz-UZ') : null} /></div>
        {plan && providers.length > 0 && !demo && isAdminRole(user) ? (
          <>
            <p className="text-sm text-muted">{t.subPrice(plan.price.toLocaleString('uz-UZ'))}</p>
            <p className="mb-3 text-sm font-medium">{active ? t.subUntil(active.toLocaleDateString('uz-UZ')) : t.subNone}</p>
            <PayButtons planId={plan.id} catalogId={null} providers={providers} />
          </>
        ) : (
          <p className="text-sm text-muted">{ta.settings.planNone}</p>
        )}
      </Section>

      {isAdminRole(user) && !demo ? (
        <Section title={ta.settings.team} hint={ta.settings.teamHint}>
          <TeamPanel
            members={team.map((m) => ({ id: m.id, email: m.email, role: m.role, clientIds: m.assignments.map((a) => a.clientId), you: m.id === user.userId }))}
            invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expires: i.expiresAt.toLocaleDateString('uz-UZ') }))}
            clients={clients} mailOn={mailEnabled()}
          />
        </Section>
      ) : null}
    </Page>
  );
}
