import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { shellData } from '@/lib/shell-data';
import { onest } from '@/ui/onest';
import { LocaleScope } from '@/ui/locale-scope';
import { AppFrame } from '@/ui/shell/app-frame';
import { readSidebar, readTheme } from '@/ui/shell/server-prefs';
import { ThemeRoot } from '@/ui/shell/theme-root';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const [shell, theme, sidebar] = await Promise.all([shellData(user), readTheme(), readSidebar()]);
  return (
    <ThemeRoot initial={theme} className={`app ${onest.variable}`}>
      <LocaleScope>
        <AppFrame shell={shell} sidebar={sidebar}>{children}</AppFrame>
      </LocaleScope>
    </ThemeRoot>
  );
}
