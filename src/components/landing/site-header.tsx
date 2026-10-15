import Link from 'next/link';
import { DEMO_URL, TELEGRAM_URL } from './config';
import { CONTAINER } from './container';

const NAV_LINK = 'rounded-lp px-3 py-2 text-[16px] text-lp-muted transition-colors hover:bg-lp-surface hover:text-lp-ink';

// Brand, section links, sign-in. Demo and Telegram appear only when configured.
export function SiteHeader() {
  return (
    <header className="border-b border-lp-line bg-lp-base">
      <div className={`${CONTAINER} flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2`}>
        <Link href="/" className="rounded-lp text-[20px] font-bold tracking-[-0.02em] text-lp-ink">
          MXIK Audit
        </Link>
        <nav aria-label="Asosiy">
          <ul className="-mr-3 flex flex-wrap items-center gap-x-1">
            {DEMO_URL ? (
              <li><a href={DEMO_URL} className={`${NAV_LINK} font-medium text-lp-ink`}>Demo</a></li>
            ) : null}
            <li><a href="/#narxlar" className={NAV_LINK}>Narxlar</a></li>
            {TELEGRAM_URL ? (
              <li>
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={NAV_LINK}>Telegram</a>
              </li>
            ) : null}
            <li><Link href="/sign-in" className={NAV_LINK}>Kirish</Link></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
