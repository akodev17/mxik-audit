import { LocaleScope } from '@/ui/locale-scope';
import { onest } from '@/ui/onest';
import { readTheme } from '@/ui/shell/server-prefs';

export default async function ClosedAccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app ${onest.variable} min-h-screen bg-surface`} data-theme={await readTheme()}>
      <LocaleScope>{children}</LocaleScope>
    </div>
  );
}
