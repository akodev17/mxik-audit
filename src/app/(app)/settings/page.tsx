import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { billingConfig } from '@/lib/billing/config';
import { firmPlan } from '@/lib/billing/plans';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { currentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { listLinks } from '@/lib/telegram/linking';
import { Badge } from '@/ui/badge';
import { Page, Section } from '@/ui/page';
import { PayButtons } from '@/ui/pay-buttons';
import { BrandForm } from './brand-form';
import { TelegramPanel } from './telegram-panel';

export const metadata: Metadata = { title: `${t.settingsTitle} — ${t.appName}` };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const tg = telegramConfig();
  const [demo, links, org, team] = await Promise.all([
    isDemoOrg(user.orgId),
    listLinks(user.orgId),
    db.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { name: true, brandName: true, logoData: true, logoMime: true, subscriptionUntil: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, createdAt: true } }),
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
      {!demo ? (
        <Section title={t.brandSection} hint={t.brandHint}>
          <BrandForm brandName={org.brandName ?? ''} orgName={org.name} logoUrl={logoUrl} />
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
        {plan && providers.length > 0 && !demo ? (
          <>
            <p className="text-sm text-muted">{t.subPrice(plan.price.toLocaleString('uz-UZ'))}</p>
            <p className="mb-3 text-sm font-medium">{active ? t.subUntil(active.toLocaleDateString('uz-UZ')) : t.subNone}</p>
            <PayButtons planId={plan.id} catalogId={null} providers={providers} />
          </>
        ) : (
          <p className="text-sm text-muted">{ta.settings.planNone}</p>
        )}
      </Section>

      <Section title={ta.settings.team} hint={ta.settings.teamHint}>
        <ul className="divide-y divide-line rounded-ctl border border-line">
          {team.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate">{m.email}</span>
              {m.email === user.email ? <Badge tone="brand">{ta.settings.you}</Badge> : null}
            </li>
          ))}
        </ul>
        {team.length <= 1 ? <p className="mt-2 text-sm text-muted">{ta.settings.teamEmpty}</p> : null}
      </Section>
    </Page>
  );
}
