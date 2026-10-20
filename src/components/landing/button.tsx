const BASE =
  'inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-full px-7 py-3 text-[17px] font-medium transition-colors';

const VARIANT = {
  primary: 'bg-lp-ink text-lp-base hover:bg-lp-brand',
  secondary: 'border border-lp-line-strong bg-lp-base text-lp-ink hover:border-lp-ink',
} as const;

// A link styled as a button; the label says exactly what happens.
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  download,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof VARIANT;
  download?: boolean;
  className?: string;
}) {
  return (
    <a href={href} download={download} className={`${BASE} ${VARIANT[variant]} ${className}`}>
      {children}
    </a>
  );
}

// A plain underlined text link for secondary actions.
export function TextLink({
  href,
  children,
  download,
  onClick,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  download?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <a
      href={href}
      download={download}
      onClick={onClick}
      className={`font-medium text-lp-brand-ink underline decoration-2 underline-offset-4 hover:text-lp-ink ${className}`}
    >
      {children}
    </a>
  );
}
