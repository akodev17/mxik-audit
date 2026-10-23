import { LanguageSwitch } from '@/ui/language-switch';
import { LocaleScope } from '@/ui/locale-scope';
import { TasnivoLogo } from '@/ui/logo';
import { onest } from '@/ui/onest';
import { readTheme } from '@/ui/shell/server-prefs';

/** The public report's frame: a thin bar with the product mark and the language switch, nothing to sign in to. */
export default async function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app ${onest.variable} flex min-h-screen flex-col bg-surface text-fg`} data-theme={await readTheme()}>
      <LocaleScope>
        <div className="no-print border-b border-line bg-base">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
            <TasnivoLogo className="text-data text-fg" markClassName="size-6" />
            <LanguageSwitch />
          </div>
        </div>
        <div className="flex-1">{children}</div>
      </LocaleScope>
    </div>
  );
}
