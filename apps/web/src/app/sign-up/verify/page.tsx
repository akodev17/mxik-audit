import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { AuthTitle } from '@/ui/auth-parts';
import { VerifyCodeForm } from './verify-code-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.verifyX.title} — ${t.appName}`, robots: { index: false } };
}

/**
 * The code step after sign-up (and after signing in with an unconfirmed address): the six-digit
 * code from the mail. The API refuses every other page to this user until the code is entered.
 */
export default async function VerifyEmailPage() {
  const me = await signedIn();
  if (!me) redirect('/sign-in');
  if (me.verified) redirect('/dashboard');
  const { ta } = await getI18n();
  return (
    <>
      <AuthTitle title={ta.verifyX.title} lead={ta.verifyX.lead(me.email)} />
      <VerifyCodeForm />
    </>
  );
}
