import Link from 'next/link';
import { t } from '@/lib/i18n';

const STEPS = [
  { href: '/upload', label: t.navUpload },
  { href: '/report', label: t.navReport },
  { href: '/review', label: t.navReview },
  { href: '/export', label: t.navExport },
] as const;

export function Header({ email, current }: { email?: string; current?: string }) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-6 px-6 py-4">
        <Link href="/report" className="shrink-0">
          <span className="font-serif text-lg font-semibold tracking-tight">{t.appName}</span>
        </Link>
        <nav className="no-print flex flex-1 items-baseline gap-5 text-sm">
          {STEPS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={current === s.href ? 'page' : undefined}
              className={
                current === s.href
                  ? 'border-b-2 border-ink pb-0.5 font-medium text-ink'
                  : 'text-ink-soft hover:text-ink'
              }
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {email ? (
          <form action="/api/sign-out" method="post" className="no-print flex items-baseline gap-3">
            <span className="text-xs text-ink-faint">{email}</span>
            <button type="submit" className="text-xs text-ink-soft underline hover:text-ink">
              {t.signOut}
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>;
}

/** Says plainly when the suggestion engine is not at full strength. */
export function DegradedBanner({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="mb-6 border-l-2 border-risk bg-risk-tint px-4 py-3 text-sm text-ink-soft">
      <strong className="font-medium text-ink">{t.degradedNotice}</strong>
      <span className="ml-1">({reasons.join(', ')})</span>
    </div>
  );
}

const BAND_STYLE = {
  high: 'bg-ok-tint text-ok border-ok/30',
  medium: 'bg-[#fdf6e7] text-[#8a5a00] border-[#8a5a00]/25',
  low: 'bg-risk-tint text-risk border-risk/25',
} as const;

const BAND_LABEL = {
  high: t.confidenceHigh,
  medium: t.confidenceMedium,
  low: t.confidenceLow,
} as const;

export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return <span className="text-xs text-ink-faint">—</span>;
  const band = confidence >= 0.9 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  return (
    <span
      title={BAND_LABEL[band]}
      className={`inline-block border px-1.5 py-0.5 text-xs tnum ${BAND_STYLE[band]}`}
    >
      {Math.round(confidence * 100)}%
    </span>
  );
}

const TYPE_LABEL: Record<string, string> = {
  MISSING: t.typeMissing,
  NOT_FOUND: t.typeNotFound,
  MISMATCH: t.typeMismatch,
  UNIT_CONFLICT: t.typeUnitConflict,
};

export function TypeBadge({ type, severity }: { type: string; severity: string }) {
  const high = severity === 'high';
  return (
    <span
      className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${
        high ? 'border-risk/30 bg-risk-tint text-risk' : 'border-rule bg-paper-tint text-ink-soft'
      }`}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

export { TYPE_LABEL };
