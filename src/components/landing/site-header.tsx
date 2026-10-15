import Link from 'next/link';
import { WRAP } from './primitives';

export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className={`${WRAP} flex items-baseline justify-between py-4`}>
        <span className="font-serif text-lg font-semibold">MXIK Audit</span>
        <Link href="/sign-in" className="-my-2 inline-block py-2 text-sm text-ink-soft underline hover:text-ink">
          Kirish
        </Link>
      </div>
    </header>
  );
}
