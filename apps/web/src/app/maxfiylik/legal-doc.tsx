import type { ReactNode } from 'react';
import { CONTAINER } from '@/components/landing/container';
import { LandingShell } from '@/components/landing/shell';

export type LegalSection = { id: string; title: string; body: ReactNode };

// Both legal pages are Uzbek only (as their text), so their few frame words are too.
const ON_PAGE = 'Mundarija';
const UPDATED = 'Oxirgi tahrir';

/**
 * The privacy policy and the offer: a readable column (about 70 characters a line) with numbered
 * sections, and a table of contents beside it on wide screens (above it on a phone).
 */
export function LegalDoc({ title, updated, intro, sections, footer }: { title: string; updated: ReactNode; intro?: ReactNode; sections: LegalSection[]; footer?: ReactNode }) {
  const toc = (
    <ol className="space-y-2 border-l border-lp-line text-[15px]">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} className="-ml-px flex gap-2 border-l-2 border-transparent pl-3 leading-snug text-lp-muted hover:border-lp-brand hover:text-lp-ink">
            <span aria-hidden className="tabular-nums text-lp-muted">{i + 1}.</span>{s.title}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <LandingShell>
      <div className={`${CONTAINER} py-12 sm:py-16`}>
        <div className="lg:grid lg:grid-cols-[minmax(0,44rem)_15rem] lg:justify-between lg:gap-16">
          <article className="min-w-0">
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[44px]">{title}</h1>
            <p className="mt-3 text-[16px] text-lp-muted">{UPDATED}: {updated}</p>
            <nav aria-label={ON_PAGE} className="mt-8 rounded-lp border border-lp-line p-4 lg:hidden">
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-lp-muted">{ON_PAGE}</p>
              {toc}
            </nav>
            <div className="mt-10 text-[17px] leading-[1.75] [&_li]:mt-2 [&_li::marker]:text-lp-muted [&_p+p]:mt-3 [&_p+ul]:mt-3 [&_ul+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
              {intro ? <div className="mb-10">{intro}</div> : null}
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-8 border-t border-lp-line pt-8 first:border-t-0 first:pt-0 [&+section]:mt-10">
                  <h2 id={`${s.id}-title`} className="mb-3 text-[24px] font-semibold leading-tight tracking-tight">
                    <span className="mr-2 tabular-nums text-lp-muted">{i + 1}.</span>{s.title}
                  </h2>
                  {s.body}
                </section>
              ))}
              {footer ? <div className="mt-12 border-t border-lp-line pt-6 text-[15px] text-lp-muted">{footer}</div> : null}
            </div>
          </article>
          <aside className="hidden lg:block">
            <nav aria-label={ON_PAGE} className="sticky top-8">
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-lp-muted">{ON_PAGE}</p>
              {toc}
            </nav>
          </aside>
        </div>
      </div>
    </LandingShell>
  );
}
