import { redirect } from 'next/navigation';
import { isApiError } from '@tasnivo/api-client';
import { fmtDate } from '@tasnivo/i18n/format';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { AuthResult } from '@/ui/auth-parts';
import { IconClock } from '@/ui/icons';
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
  const { locale, ta } = await getI18n();
  const status = await closedStatus();
  if (!status) redirect('/sign-in');
  if (!status.purgeOn) redirect('/dashboard');
  return (
    <AuthResult
      tone="danger" role="none" icon={<IconClock size={24} />} title={ta.security.closedTitle}
      action={<>{status.canReopen ? <ReopenButton /> : null}<SignOutButton /></>}
    >
      <p>{ta.security.closedText(fmtDate(locale, status.purgeOn))}</p>
      {status.canReopen ? null : <p>{ta.security.restoreOnlyAdmin}</p>}
    </AuthResult>
  );
}
