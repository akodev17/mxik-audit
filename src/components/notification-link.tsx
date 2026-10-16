// Header link to the notifications page, with the unread count. Server-only.
import Link from 'next/link';
import { t } from '@/lib/i18n';
import { unreadCount } from '@/lib/notifications';
import { currentUser } from '@/lib/session';

export async function NotificationLink() {
  const user = await currentUser();
  if (!user) return null;
  const unread = await unreadCount(user.orgId).catch(() => 0);
  return (
    <Link href="/notifications" className="text-xs text-ink-soft underline hover:text-ink">
      {t.notificationsNav}
      {unread > 0 ? <span className="ml-1 bg-risk px-1.5 py-0.5 text-paper no-underline tnum">{unread}</span> : null}
    </Link>
  );
}
