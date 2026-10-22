import { redirect } from 'next/navigation';
import { reopenAccount } from '@/app/actions/security';
import { db } from '@tasnivo/db';
import { fmtDate } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { purgeDate } from '@tasnivo/domain/security/account';
import { isLive } from '@tasnivo/domain/security/session-store';
import { getSession } from '@/lib/session';
import { Button } from '@/ui/button';

/** Shown to the admin of a closed account: when it will be erased, and how to restore it. */
export default async function ClosedAccountPage() {
  const { locale, t, ta } = await getI18n();
  const session = await getSession();
  const { userId, orgId, sid } = session;
  if (!userId || !orgId || !sid || !(await isLive(sid, userId))) redirect('/sign-in');
  const [date, user] = await Promise.all([purgeDate(orgId), db.user.findFirst({ where: { id: userId, orgId }, select: { role: true } })]);
  if (!date) redirect('/dashboard');
  const isAdmin = user?.role === 'admin';
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-lg">{ta.security.closedTitle}</h1>
      <p className="text-sm">{ta.security.closedText(fmtDate(locale, date))}</p>
      {isAdmin ? (
        <form action={reopenAccount}><Button type="submit" variant="primary">{ta.security.restore}</Button></form>
      ) : <p className="text-sm text-muted">{ta.security.restoreOnlyAdmin}</p>}
      <form action="/api/sign-out" method="post"><Button type="submit" variant="secondary">{ta.security.signOut}</Button></form>
      <span className="sr-only">{t.appName}</span>
    </main>
  );
}
