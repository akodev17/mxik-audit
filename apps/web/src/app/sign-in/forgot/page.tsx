import type { Metadata } from 'next';
import Link from 'next/link';
import { SUPPORT_EXTERNAL, SUPPORT_URL } from '@/components/landing/config';
import { getI18n } from '@/lib/locale';
import { serverApi } from '@/lib/api/server';
import { AuthResult } from '@/ui/auth-parts';
import { ButtonLink } from '@/ui/button';
import { IconArrowLeft } from '@/ui/icons';
import { ForgotForm } from './forgot-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.secX.forgot.title} — ${t.appName}`, robots: { index: false } };
}

/** Password reset request. Without e-mail it says so and offers a way to reach us instead. */
export default async function ForgotPage() {
  const { ta } = await getI18n();
  const { mailEnabled: mail } = await serverApi().auth.config();
  return (
    <>
      <Link href="/sign-in" className="mb-8 inline-flex items-center gap-1.5 rounded-sm text-body font-medium text-muted hover:text-fg">
        <IconArrowLeft size={16} />
        {ta.secX.backToSignIn}
      </Link>
      {mail ? <ForgotForm /> : (
        <AuthResult
          tone="info" title={ta.secX.forgot.title}
          action={<ButtonLink variant="primary" size="lg" className="w-full" href={SUPPORT_URL} target={SUPPORT_EXTERNAL ? '_blank' : undefined}>{ta.secX.forgot.contact}</ButtonLink>}
        >
          <p>{ta.secX.forgot.noMail}</p>
        </AuthResult>
      )}
    </>
  );
}
