import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server';
import { TwoFactorForm } from './two-factor-form';

export default async function TwoFactorPage() {
  if (!(await serverApi().auth.twoFactorPending()).pending) redirect('/sign-in');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <TwoFactorForm />
    </main>
  );
}
