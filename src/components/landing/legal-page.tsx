import { CONTAINER } from './container';
import { LandingShell } from './shell';

// A blank the owner still has to fill: loud on purpose, never filled with guesses.
export function Todo({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-sm bg-lp-warn-fill px-1 text-lp-ink outline outline-1 outline-lp-warn" data-todo>
      [TODO: {children}]
    </mark>
  );
}

// Shared frame for the privacy policy and the offer.
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
    <LandingShell>
      <div className={`${CONTAINER} py-12 sm:py-16`}>
        <article className="max-w-[44rem]">
          <h1 className="text-[34px] sm:text-[44px]">{title}</h1>
          <p className="mt-3 text-[16px] text-lp-muted">Oxirgi tahrir: {updated}</p>
          <div className="mt-10 space-y-10 text-[17px] leading-relaxed [&_h2]:text-[24px] [&_li]:mt-2 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </div>
    </LandingShell>
  );
}
