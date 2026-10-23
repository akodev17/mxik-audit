import { TasnivoLogo } from '@/ui/logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HtmlLang } from '@/components/html-lang';
import type { Locale } from '@tasnivo/i18n/i18n';
import { LocaleProvider } from '@/lib/locale-client';
import { buttonClass } from '@/ui/button';
import { LanguageSwitch } from '@/ui/language-switch';
import { onest } from '@/ui/onest';
import type { Theme } from '@/ui/theme';

type Props = { locale: Locale; theme: Theme; title: string; back: { href: string; label: string }; children: ReactNode };

/** A minimal docs frame in the app's tokens: brand, page name, language switch and a way back. */
export function DocsShell({ locale, theme, title, back, children }: Props) {
  return (
    <div className={`app ${onest.variable} min-h-screen bg-base`} lang={locale} data-theme={theme}>
      <HtmlLang lang={locale} />
      <LocaleProvider locale={locale}>
        <header className="relative z-sticky border-b sm:sticky sm:top-0 border-line bg-base/95 backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-page-wide flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
            <p className="flex min-w-0 items-center gap-3">
              <Link href="/" className="text-section font-semibold"><TasnivoLogo markClassName="size-6" /></Link>
              <span aria-hidden className="hidden h-5 w-px bg-line sm:block" /><span className="hidden truncate text-small font-medium text-muted sm:inline">{title}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <LanguageSwitch />
              <Link href={back.href} className={buttonClass('secondary', 'sm')}>{back.label}</Link>
            </div>
          </div>
        </header>
        <main id="main" className="relative mx-auto max-w-page-wide px-4 py-8 sm:px-6 lg:py-12">{children}</main>
      </LocaleProvider>
    </div>
  );
}
