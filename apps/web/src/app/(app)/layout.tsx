import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { onest } from '@/ui/onest';
import { LocaleScope } from '@/ui/locale-scope';
import { AppFrame } from '@/ui/shell/app-frame';
import { readSidebar, readTheme } from '@/ui/shell/server-prefs';
import { ThemeRoot } from '@/ui/shell/theme-root';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No session: the API answers 401 and pageData sends the browser to sign-in.
  const [shell, theme, sidebar] = await Promise.all([pageData(serverApi().notifications.shell()), readTheme(), readSidebar()]);
  return (
    <ThemeRoot initial={theme} className={`app ${onest.variable}`}>
      <LocaleScope>
        <AppFrame shell={shell} sidebar={sidebar}>{children}</AppFrame>
      </LocaleScope>
    </ThemeRoot>
  );
}
