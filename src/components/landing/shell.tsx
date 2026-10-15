import { onest } from './fonts';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

// Wraps every public page in the landing font, tokens, header and footer.
export function LandingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`landing ${onest.variable} min-h-screen`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lp focus:bg-lp-brand focus:px-4 focus:py-2 focus:text-white"
      >
        Asosiy qismga oʻtish
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
