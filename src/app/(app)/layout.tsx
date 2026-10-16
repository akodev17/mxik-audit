import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { shellData } from '@/lib/shell-data';
import { onest } from '@/ui/onest';
import { LocaleScope } from '@/ui/locale-scope';
import { AppFrame } from '@/ui/shell/app-frame';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const shell = await shellData(user);
  return (
    <div className={`app ${onest.variable}`}>
      <LocaleScope>
        <AppFrame shell={shell}>{children}</AppFrame>
      </LocaleScope>
    </div>
  );
}
