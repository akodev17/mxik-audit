import type { Metadata } from 'next';
import { Capabilities } from '@/components/landing/capabilities';
import { ButtonLink } from '@/components/landing/button';
import { Faq } from '@/components/landing/faq';
import { Hero } from '@/components/landing/hero';
import { Pricing } from '@/components/landing/pricing';
import { SiteHeader } from '@/components/landing/site-header';
import { LocaleScope } from '@/ui/locale-scope';
import { GuideShell } from './shell';
import { readTokens } from './token-source';

export const metadata: Metadata = { title: 'Style guide (local only)', robots: { index: false, follow: false } };

/**
 * Local-only visual reference for the design system. The ".dev.tsx" page extension exists only for
 * `next dev` (see next.config.ts), so in a production build this file is not a route at all. It uses
 * the real shared components and reads token values from the stylesheets; it touches no customer data.
 */
export default async function StyleGuidePage() {
  const tokens = await readTokens();
  return (
    <LocaleScope>
      <GuideShell
        app={tokens.app}
        landing={tokens.landing}
        marketing={
          <div className="landing overflow-hidden rounded-ctl border border-line bg-lp-base text-lp-ink">
            <p className="border-b border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">SiteHeader</p>
            <SiteHeader />
            <p className="border-y border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">Hero (headline, two actions, product window)</p>
            <Hero />
            <p className="border-y border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">Capabilities (feature section)</p>
            <Capabilities />
            <p className="border-y border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">Pricing (data from landing/config.ts)</p>
            <Pricing />
            <p className="border-y border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">Faq (native accordion)</p>
            <Faq />
            <p className="border-y border-lp-line bg-lp-surface px-4 py-2 font-mono text-[12px] text-lp-muted">Final CTA (panel only; the real one holds the lead form, which is not rendered here)</p>
            <div className="bg-lp-surface px-3 py-10 sm:px-4">
              <div className="mx-auto flex max-w-3xl flex-col items-start gap-4 rounded-lp-xl bg-lp-brand p-8 text-white">
                <h3 className="lp-display text-[1.75rem] font-bold">Faylingizni yuboring va riskli pozitsiyalar roʻyxatini oling</h3>
                <ButtonLink href="/sign-up" variant="secondary">Bepul boshlash</ButtonLink>
              </div>
            </div>
          </div>
        }
      />
    </LocaleScope>
  );
}
