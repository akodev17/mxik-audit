import Link from 'next/link';
import { demoTtlHours } from '@/lib/demo-config';
import { t } from '@/lib/i18n';
import { NotificationLink } from './notification-link';

const STEPS = [
  { href: '/upload', label: t.navUpload, perCatalog: false },
  { href: '/report', label: t.navReport, perCatalog: true },
  { href: '/review', label: t.navReview, perCatalog: true },
  { href: '/export', label: t.navExport, perCatalog: true },
  { href: '/catalogs', label: t.navCatalogs, perCatalog: false },
  { href: '/clients', label: t.navClients, perCatalog: false },
  { href: '/settings', label: t.navSettings, perCatalog: false },
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
            <NotificationLink />
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

export { ConfidenceBadge, TypeBadge, TYPE_LABEL } from './badges';
