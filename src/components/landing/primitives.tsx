export const WRAP = 'mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10';

/** One primary action on the page, in three places: hero, after the report, and
 *  the form itself. Anything else on the page is a quiet link. */
export function Cta({ className = '' }: { className?: string }) {
  return (
    <a
      href="#audit"
      className={
        'inline-flex items-center justify-center gap-2 bg-ink px-6 py-3.5 '
        + 'font-medium text-paper transition-colors hover:bg-black '
        + `focus-visible:outline-offset-4 ${className}`
      }
    >
      <span className="whitespace-nowrap">Katalogni bepul tekshirtirish</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/**
 * Full-bleed rule-to-rule band. Big measured numbers should feel like a total
 * line ruled off in a report, not like a KPI card, so: hairlines, tabular
 * figures, no rounded corners, no shadow, no icon.
 */
export function DataBand({
  items,
  tone = 'neutral',
}: {
  items: readonly { value: string; label: string; note?: string }[];
  tone?: 'neutral' | 'risk';
}) {
  return (
    <div className={`border-y border-rule ${tone === 'risk' ? 'bg-risk-tint' : 'bg-paper-tint'}`}>
      <dl
        className={
          `${WRAP} grid grid-cols-1 divide-y divide-rule sm:grid-cols-3 `
          + 'sm:divide-x sm:divide-y-0'
        }
      >
        {items.map((item) => (
          <div key={item.label} className="py-7 sm:px-7 sm:py-8 sm:first:pl-0 sm:last:pr-0">
            <dt className="sr-only">{item.label}</dt>
            <dd>
              <span
                className={
                  'block font-serif text-[34px] leading-none tnum sm:text-[40px] '
                  + (tone === 'risk' ? 'text-risk' : '')
                }
              >
                {item.value}
              </span>
              <span className="mt-2.5 block max-w-[26ch] text-sm text-ink-soft">{item.label}</span>
              {item.note ? (
                <span className="mt-1 block max-w-[30ch] text-xs text-ink-faint">{item.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
      {meta ? <span className="text-[11px] text-ink-faint tnum">{meta}</span> : null}
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
    <div className="flex items-center gap-3 py-3.5" aria-hidden="true">
      <span className="text-ink-faint">↓</span>
      {label ? <span className="eyebrow">{label}</span> : null}
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}
