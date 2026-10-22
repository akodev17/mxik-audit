import { redirect } from 'next/navigation';
import { hasPending } from '@/lib/security/sign-in';
import { TwoFactorForm } from './two-factor-form';

export default async function TwoFactorPage() {
  if (!(await hasPending())) redirect('/sign-in');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <TwoFactorForm />
    </main>
  );
}
