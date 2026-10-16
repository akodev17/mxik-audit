import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listNotifications, markAllRead } from '@/lib/notifications';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.notificationsTitle} — ${t.appName}` };
}

export default async function NotificationsPage() {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const items = await listNotifications(user.orgId);
  // Seen once listed; the bell count clears on the next page.
  await markAllRead(user.orgId);

  // Newest first inside each client, clients in order of their latest notice.
  const groups = new Map<string, { name: string; id: string | null; items: typeof items }>();
  for (const n of items) {
    const key = n.client?.id ?? '';
    const group = groups.get(key) ?? { name: n.client?.name ?? ta.notices.general, id: n.client?.id ?? null, items: [] };
    group.items.push(n);
    groups.set(key, group);
  }

  return (
    <Page title={t.notificationsTitle} hint={t.notificationsHint}>
      {items.length === 0 ? (
        <EmptyState title={t.notificationsEmpty} />
      ) : (
        <div className="space-y-8">
          {[...groups.values()].map((g) => (
            <section key={g.id ?? 'general'}>
              <h2 className="mb-2 text-base">
                {g.id ? <Link href={`/clients/${g.id}`} className="hover:text-brand">{g.name}</Link> : g.name}
              </h2>
              <ol className="divide-y divide-line rounded-ctl border border-line">
                {g.items.map((n) => (
                  <li key={n.id} className={`px-4 py-3 ${n.readAt ? '' : 'bg-brand-tint/50'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-4">
                      <span className="flex items-center gap-2 font-medium">
                        {n.title}
                        {n.readAt ? null : <Badge tone="brand">{ta.notices.unread}</Badge>}
                      </span>
                      <span className="text-xs text-muted">{n.createdAt.toLocaleString('uz-UZ')}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{n.body}</p>
                    {n.href ? <Link href={n.href} className="mt-1 inline-block text-sm text-brand hover:underline">{ta.notices.open}</Link> : null}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
