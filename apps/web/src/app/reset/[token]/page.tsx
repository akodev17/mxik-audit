import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { AuthResult, AuthTitle } from '@/ui/auth-parts';
import { ButtonLink } from '@/ui/button';
import { ResetForm } from './reset-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  // The token is in the URL: keep it out of Referer headers and search engines.
  return { title: `${ta.secX.reset.title} — ${t.appName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { ta } = await getI18n();
  const { token } = await params;
  const { email, passwordMin } = await serverApi().auth.resetTarget({ token });
  if (!email) {
    return (
      <AuthResult
        tone="danger" role="none" title={ta.secX.reset.bad}
        action={<ButtonLink href="/sign-in/forgot" variant="primary" size="lg" className="w-full">{ta.secX.reset.again}</ButtonLink>}
      >
        <p>{ta.secX.reset.badHint}</p>
      </AuthResult>
    );
  }
  return (
    <>
      <AuthTitle title={ta.secX.reset.title} lead={ta.authX.reset.lead(email)} />
      <ResetForm token={token} min={passwordMin} />
    </>
  );
}
