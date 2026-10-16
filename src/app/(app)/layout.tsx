import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { shellData } from '@/lib/shell-data';
import { onest } from '@/ui/onest';
import { AppFrame } from '@/ui/shell/app-frame';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const shell = await shellData(user);
  return (
    <div className={`app ${onest.variable}`}>
      <AppFrame shell={shell}>{children}</AppFrame>
    </div>
  );
}
