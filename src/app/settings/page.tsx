import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { listLinks } from '@/lib/telegram/linking';
import { TelegramPanel } from './telegram-panel';

export const metadata: Metadata = { title: `${t.settingsTitle} — ${t.appName}` };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const tg = telegramConfig();
  const [demo, links] = await Promise.all([isDemoOrg(user.orgId), listLinks(user.orgId)]);

  return (
    <>
      <Header email={user.email} current="/settings" demo={user.demo} />
      <Shell demo={user.demo}>
        <h1 className="text-2xl">{t.settingsTitle}</h1>

        <section className="mt-8 max-w-3xl">
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
