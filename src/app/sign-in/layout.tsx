import { LanguageSwitch } from '@/ui/language-switch';
import { LocaleScope } from '@/ui/locale-scope';
import { onest } from '@/ui/onest';
import { readTheme } from '@/ui/shell/server-prefs';

export default async function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app ${onest.variable} min-h-screen bg-surface`} data-theme={await readTheme()}>
      <LocaleScope>
        <div className="absolute right-4 top-4 z-10"><LanguageSwitch /></div>
        {children}
      </LocaleScope>
    </div>
  );
}
