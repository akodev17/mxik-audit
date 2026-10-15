import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { WRAP } from './primitives';

/**
 * A blank the owner still has to fill. Deliberately loud: it must be
 * impossible to publish a legal page with one of these left in unnoticed, and
 * nothing here is ever filled with an invented name, address or number.
 */
export function Todo({ children }: { children: React.ReactNode }) {
  return (
    <mark className="bg-[#fff1b8] px-1 font-mono text-[0.9em] text-ink" data-todo>
      [TODO: {children}]
    </mark>
  );
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className={`${WRAP} py-12 sm:py-16`}>
        <article className="max-w-[68ch]">
          <h1 className="text-[32px] leading-tight sm:text-[40px]">{title}</h1>
          <p className="mt-3 text-[13px] text-ink-soft">Oxirgi tahrir: {updated}</p>
          <div className="legal mt-9 space-y-8 text-[15px] leading-relaxed text-ink-soft [&_h2]:text-[21px] [&_h2]:text-ink [&_li]:mt-1.5 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
