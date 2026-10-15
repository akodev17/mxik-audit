import Link from 'next/link';
import { DEMO_URL, TELEGRAM_URL } from './config';
import { WRAP } from './primitives';

const LINK = '-my-2 inline-block py-2 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline';

/* Demo and Telegram only render when configured: a header link that goes
   nowhere is worse than no link. */
export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className={`${WRAP} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4`}>
        <Link href="/" className="font-serif text-lg font-semibold">
          MXIK Audit
        </Link>
        <nav aria-label="Asosiy">
          <ul className="flex list-none flex-wrap items-baseline gap-x-5 p-0">
            {DEMO_URL ? (
              <li>
                <a href={DEMO_URL} className={`${LINK} font-medium text-ink`}>
                  Demo
                </a>
              </li>
            ) : null}
            <li>
              <a href="#narxlar" className={LINK}>
                Narxlar
              </a>
            </li>
            {TELEGRAM_URL ? (
              <li>
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Telegram
                </a>
              </li>
            ) : null}
            <li>
              <Link href="/sign-in" className={`${LINK} underline`}>
                Kirish
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
