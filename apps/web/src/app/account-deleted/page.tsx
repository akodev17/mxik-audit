import { redirect } from 'next/navigation';
import { isApiError } from '@tasnivo/api-client';
import { fmtDate } from '@tasnivo/i18n/format';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ReopenButton, SignOutButton } from './closed-actions';

/** Without a live session record the API answers 401: back to sign in. */
async function closedStatus() {
  try {
    return await serverApi().account.closedStatus();
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

/** Shown to the admin of a closed account: when it will be erased, and how to restore it. */
export default async function ClosedAccountPage() {
  const { locale, t, ta } = await getI18n();
  const status = await closedStatus();
  if (!status) redirect('/sign-in');
  if (!status.purgeOn) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-lg">{ta.security.closedTitle}</h1>
      <p className="text-sm">{ta.security.closedText(fmtDate(locale, status.purgeOn))}</p>
      {status.canReopen ? <ReopenButton /> : <p className="text-sm text-muted">{ta.security.restoreOnlyAdmin}</p>}
      <SignOutButton />
      <span className="sr-only">{t.appName}</span>
    </main>
  );
}
