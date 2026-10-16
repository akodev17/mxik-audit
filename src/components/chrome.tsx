import Link from 'next/link';
import { confidenceLabel } from '@/core/match/confidence-labels';
import { demoTtlHours } from '@/lib/demo-config';
import { t } from '@/lib/i18n';

const STEPS = [
  { href: '/upload', label: t.navUpload, perCatalog: false },
  { href: '/report', label: t.navReport, perCatalog: true },
  { href: '/review', label: t.navReview, perCatalog: true },
  { href: '/export', label: t.navExport, perCatalog: true },
  { href: '/catalogs', label: t.navCatalogs, perCatalog: false },
] as const;

type HeaderProps = {
  email?: string;
  current?: string;
  /** Keeps report/review/export on the catalogue being viewed. */
  catalogId?: string | null;
  demo?: boolean;
};

export function Header({ email, current, catalogId, demo }: HeaderProps) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-6 py-4">
        <Link href="/report" className="shrink-0">
          <span className="font-serif text-lg font-semibold tracking-tight">{t.appName}</span>
          {demo ? (
            <span className="ml-2 border border-risk/40 bg-risk-tint px-1.5 py-0.5 align-middle font-sans text-xs text-risk">
              {t.demoBadge}
            </span>
          ) : null}
        </Link>
        <nav className="no-print flex flex-1 flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">
          {STEPS.map((s) => (
            <Link
              key={s.href}
              href={s.perCatalog && catalogId ? `${s.href}?catalog=${catalogId}` : s.href}
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

export function Shell({ children, demo }: { children: React.ReactNode; demo?: boolean }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {demo ? (
        <p className="no-print mb-6 border-l-2 border-risk bg-risk-tint px-4 py-2 text-sm text-ink-soft">
          {t.demoBanner(demoTtlHours())}
        </p>
      ) : null}
      {children}
    </main>
  );
}

const LABEL_STYLE = {
  sure: 'bg-ok-tint text-ok border-ok/30',
  likely: 'bg-[#fdf6e7] text-[#8a5a00] border-[#8a5a00]/25',
  check: 'bg-risk-tint text-risk border-risk/25',
} as const;

const LABEL_TEXT = {
  sure: t.confidenceSure,
  likely: t.confidenceLikely,
  check: t.confidenceCheck,
} as const;

/** A plain-language label; the raw number is detail, kept in the tooltip. */
export function ConfidenceBadge({ confidence, barcode }: { confidence: number | null; barcode?: boolean }) {
  if (confidence === null) return <span className="text-xs text-ink-faint">—</span>;
  const label = confidenceLabel(confidence, { barcode });
  return (
    <span
      title={t.confidenceDetail(Math.round(confidence * 100))}
      className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${LABEL_STYLE[label]}`}
    >
      {LABEL_TEXT[label]}
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
