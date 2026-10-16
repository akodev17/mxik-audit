import { DEMO_URL } from './config';

export const WRAP = 'mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10';

const BUTTON = {
  primary: 'bg-ink text-paper hover:bg-black border border-ink',
  secondary: 'border border-ink bg-paper text-ink hover:bg-paper-tint',
} as const;

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof BUTTON;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={
        'inline-flex min-h-12 items-center justify-center gap-2 px-6 py-3 '
        + `font-medium transition-colors focus-visible:outline-offset-4 ${BUTTON[variant]} ${className}`
      }
    >
      <span className="whitespace-nowrap">{children}</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

/**
 * The page's two actions. The demo is primary because this audience trusts
 * what it sees working — but no public demo exists in the app yet, so until
 * NEXT_PUBLIC_DEMO_URL is set the free audit becomes the primary action and
 * the second slot shows `fallback` (by default: a link to the sample report).
 */
export function CtaPair({
  className = '',
  fallback = <ButtonLink href="#hisobot" variant="secondary">Namuna hisobotni koʻrish</ButtonLink>,
}: {
  className?: string;
  fallback?: React.ReactNode;
}) {
  return (
    <div
      className={
        'flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 '
        + className
      }
    >
      {DEMO_URL ? (
        <>
          <ButtonLink href={DEMO_URL}>Demoni sinab koʻrish</ButtonLink>
          <ButtonLink href="#audit" variant="secondary">Katalogni bepul tekshirtirish</ButtonLink>
        </>
      ) : (
        <>
          <ButtonLink href="#audit">Katalogni bepul tekshirtirish</ButtonLink>
          {fallback}
        </>
      )}
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** Eyebrow + heading + optional lead paragraph: every section opens this way. */
export function SectionHead({
  eyebrow,
  title,
  lead,
  titleClass = 'max-w-[28ch]',
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  titleClass?: string;
}) {
  return (
    <>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className={`mt-3 text-[27px] leading-tight sm:text-[32px] ${titleClass}`}>{title}</h2>
      {lead ? <p className="mt-4 max-w-[62ch] text-ink-soft">{lead}</p> : null}
    </>
  );
}

/* --------------------------------------------------------------- diagram parts

   These are drawing primitives, not miniature copies of the application. They
   have no navigation, no toolbar and no clickable-looking controls: a reader
   must never mistake a figure for the product, in either direction. What they
   carry is structure — a row, a rule, a marker, an arrow, a code. */

/** Caption strip that names a figure, the way a table in a report is titled. */
export function FigureHead({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-2.5">
      <span className="eyebrow">{label}</span>
      {meta ? <span className="text-xs text-ink-faint tnum">{meta}</span> : null}
    </div>
  );
}

/** Risk or verified marker. A single glyph, never a coloured pill. */
export function Mark({ risk }: { risk: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border text-[11px] '
        + (risk ? 'border-risk/40 text-risk' : 'border-rule-strong text-ink-faint')
      }
    >
      {risk ? '!' : '✓'}
    </span>
  );
}

export function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-3" aria-hidden="true">
      <span className="text-ink-faint">↓</span>
      {label ? <span className="eyebrow">{label}</span> : null}
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}
