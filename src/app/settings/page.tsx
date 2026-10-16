import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { PayButtons } from '@/components/pay-buttons';
import { billingConfig } from '@/lib/billing/config';
import { firmPlan } from '@/lib/billing/plans';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { listLinks } from '@/lib/telegram/linking';
import { BrandForm } from './brand-form';
import { TelegramPanel } from './telegram-panel';

export const metadata: Metadata = { title: `${t.settingsTitle} — ${t.appName}` };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const tg = telegramConfig();
  const [demo, links, org] = await Promise.all([
    isDemoOrg(user.orgId),
    listLinks(user.orgId),
    db.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { name: true, brandName: true, logoData: true, logoMime: true, subscriptionUntil: true } }),
  ]);
  // The firm plan shows only once its price is set and a provider is configured.
  const billing = billingConfig();
  const plan = firmPlan();
  const providers = [billing.click ? 'click' as const : null, billing.payme ? 'payme' as const : null]
    .filter((x): x is 'click' | 'payme' => x !== null);
  const active = org.subscriptionUntil && org.subscriptionUntil > new Date() ? org.subscriptionUntil : null;
  const logoUrl = org.logoData && org.logoMime ? `data:${org.logoMime};base64,${Buffer.from(org.logoData).toString('base64')}` : null;

  return (
    <>
      <Header email={user.email} current="/settings" demo={user.demo} />
      <Shell demo={user.demo}>
        <h1 className="text-2xl">{t.settingsTitle}</h1>

        {!demo ? (
          <section className="mt-8 max-w-3xl">
            <h2 className="mb-1 text-lg">{t.brandSection}</h2>
            <p className="mb-4 text-sm text-ink-soft">{t.brandHint}</p>
            <BrandForm brandName={org.brandName ?? ''} orgName={org.name} logoUrl={logoUrl} />
          </section>
        ) : null}

        {plan && providers.length > 0 && !demo ? (
          <section className="mt-10 max-w-3xl">
            <h2 className="mb-1 text-lg">{t.subTitle}</h2>
            <p className="text-sm text-ink-soft tnum">{t.subPrice(plan.price.toLocaleString('uz-UZ'))}</p>
            <p className="mb-3 text-sm">{active ? t.subUntil(active.toLocaleDateString('uz-UZ')) : t.subNone}</p>
            <PayButtons planId={plan.id} catalogId={null} providers={providers} />
          </section>
        ) : null}

        <section className="mt-10 max-w-3xl">
          <h2 className="mb-2 text-lg">{t.tgSection}</h2>
          {!tg.enabled ? (
            <p className="text-sm text-ink-soft">{t.tgOff}</p>
          ) : demo ? (
            <p className="text-sm text-ink-soft">{t.tgDemoOff}</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-soft">{t.tgIntro(tg.username)}</p>
              <TelegramPanel chats={links.map((l) => ({ id: l.id, username: l.username, linkedAt: l.createdAt.toLocaleDateString('uz-UZ') }))} />
            </>
          )}
        </section>
      </Shell>
    </>
  );
}
