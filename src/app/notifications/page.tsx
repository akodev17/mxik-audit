import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { t } from '@/lib/i18n';
import { listNotifications, markAllRead } from '@/lib/notifications';
import { currentUser } from '@/lib/session';

export const metadata: Metadata = { title: `${t.notificationsTitle} — ${t.appName}` };

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const items = await listNotifications(user.orgId);
  // Seen once listed; the count in the header clears on the next page.
  await markAllRead(user.orgId);

  return (
    <>
      <Header email={user.email} demo={user.demo} />
      <Shell demo={user.demo}>
        <h1 className="text-2xl">{t.notificationsTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{t.notificationsHint}</p>
        {items.length === 0 ? (
          <p className="mt-6 text-ink-soft">{t.notificationsEmpty}</p>
        ) : (
          <ol className="mt-6 border border-rule">
            {items.map((n) => (
              <li key={n.id} className={`border-b border-rule px-4 py-3 last:border-0 ${n.readAt ? '' : 'bg-risk-tint/40'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{n.title}</span>
                  <span className="tnum text-xs text-ink-faint">{n.createdAt.toLocaleString('uz-UZ')}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{n.body}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                  {n.client ? <Link href={`/clients/${n.client.id}`} className="underline">{n.client.name}</Link> : null}
                  {n.href ? <Link href={n.href} className="underline">{t.notificationsOpen}</Link> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Shell>
    </>
  );
}
