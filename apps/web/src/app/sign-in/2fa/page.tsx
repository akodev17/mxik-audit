import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { serverApi } from '@/lib/api/server';
import { AuthTitle } from '@/ui/auth-parts';
import { IconArrowLeft } from '@/ui/icons';
import { TwoFactorForm } from './two-factor-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.security.twoFactorTitle} — ${t.appName}`, robots: { index: false } };
}

export default async function TwoFactorPage() {
  if (!(await serverApi().auth.twoFactorPending()).pending) redirect('/sign-in');
  const { ta } = await getI18n();
  return (
    <>
      <AuthTitle title={ta.security.twoFactorTitle} lead={ta.security.twoFactorText} />
      <TwoFactorForm />
      <p className="mt-8 text-center text-body">
        <Link href="/sign-in" className="inline-flex items-center gap-1.5 rounded-sm font-medium text-muted hover:text-fg">
          <IconArrowLeft size={16} />
          {ta.authX.twoFactor.back}
        </Link>
      </p>
    </>
  );
}
