import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getModuleStates } from '@/lib/modules';
import { onest } from '@/ui/onest';
import { LocaleScope } from '@/ui/locale-scope';
import { AppFrame } from '@/ui/shell/app-frame';
import { ModuleStatesProvider } from '@/ui/shell/module-states';
import { readSidebar, readTheme } from '@/ui/shell/server-prefs';
import { ThemeRoot } from '@/ui/shell/theme-root';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No session: the API answers 401 and pageData sends the browser to sign-in.
  const [shell, theme, sidebar, modules] = await Promise.all([pageData(serverApi().notifications.shell()), readTheme(), readSidebar(), getModuleStates()]);
  return (
    <ThemeRoot initial={theme} className={`app ${onest.variable}`}>
      <LocaleScope>
        <ModuleStatesProvider value={modules}>
          <AppFrame shell={shell} sidebar={sidebar}>{children}</AppFrame>
        </ModuleStatesProvider>
      </LocaleScope>
    </ThemeRoot>
  );
}
