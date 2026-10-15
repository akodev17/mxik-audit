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

/** Wide measure for the redesigned page: the workspace needs the room. */
export const WIDE = 'mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-10';

/**
 * A chapter of the page, set like a section of an audit report: a number and
 * a label in the left margin, the content beside it. On phones the margin
 * becomes a single line above. The number gives the page an order a reader
 * can refer to ("see 03"); it is not decoration.
 */
export function Chapter({
  n,
  label,
  id,
  tint = false,
  children,
}: {
  n: string;
  label: string;
  id?: string;
  tint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-4 border-t border-rule ${tint ? 'bg-paper-tint' : ''}`}>
      <div className={`${WIDE} grid grid-cols-1 gap-y-5 py-14 sm:py-16 lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:gap-x-10`}>
        <p className="flex items-baseline gap-3 lg:flex-col lg:gap-2">
          <span className="code text-[13px] text-ink-faint tnum">{n}</span>
          <span className="eyebrow">{label}</span>
        </p>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
