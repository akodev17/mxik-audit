import { HtmlLang } from '@/components/html-lang';
import type { Theme } from '@/ui/theme';
import { onest } from './fonts';
import { SHELL_COPY, type SiteLang } from './shell-copy';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

type Props = {
  children: React.ReactNode;
  /** Language of the page content. Public pages are Uzbek unless they say otherwise (the help centre). */
  lang?: SiteLang;
  /** A signed-in reader gets a way back to the app instead of sign-in and sign-up. */
  signedIn?: boolean;
  /** Only the help centre follows the app theme; the landing and legal pages are light by design. */
  theme?: Theme;
};

// Wraps every public page in the landing font, tokens, header and footer. The page declares its own
// language, so <html lang> never claims Russian for Uzbek content.
export function LandingShell({ children, lang = 'uz', signedIn = false, theme }: Props) {
  return (
    <div className={`landing ${onest.variable} min-h-screen`} lang={lang} data-theme={theme}>
      <HtmlLang lang={lang} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lp focus:bg-lp-brand focus:px-4 focus:py-2 focus:text-lp-base"
      >
        {SHELL_COPY[lang].skip}
      </a>
      <SiteHeader lang={lang} signedIn={signedIn} />
      <main id="main">{children}</main>
      <SiteFooter lang={lang} />
    </div>
  );
}
