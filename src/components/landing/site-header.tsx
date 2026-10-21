import Link from 'next/link';
import { helpPath } from '@/lib/help';
import { TasnivoLogo } from '@/ui/logo';
import { DEMO_URL, TELEGRAM_URL } from './config';
import { CONTAINER } from './container';
import { SHELL_COPY, type SiteLang } from './shell-copy';

const NAV_LINK = 'rounded-lp px-3 py-2 text-[16px] text-lp-ink transition-colors hover:bg-lp-surface';
const PRIMARY = 'inline-flex min-h-10 items-center whitespace-nowrap rounded-lp bg-lp-brand px-4 text-[15px] font-medium text-white transition-colors hover:bg-lp-brand-ink md:px-5 md:text-[16px]';
const MENU_LINK = 'block rounded-lp px-3 py-2 text-[16px] text-lp-ink hover:bg-lp-surface';

type Item = { href: string; label: string; external?: boolean; strong?: boolean };

function ItemLink({ item, className }: { item: Item; className: string }) {
  if (item.external) return <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>{item.label}</a>;
  return <Link href={item.href} className={className}>{item.label}</Link>;
}

// Brand, section links and one primary action: sign up, or back to the app for a signed-in reader.
// Below md the secondary links fold into a menu so the action stays on the first row.
export function SiteHeader({ lang = 'uz', signedIn = false }: { lang?: SiteLang; signedIn?: boolean }) {
  const c = SHELL_COPY[lang];
  const items: Item[] = [
    ...(DEMO_URL ? [{ href: DEMO_URL, label: c.demo, strong: true }] : []),
    { href: '/#narxlar', label: c.pricing },
    { href: helpPath(lang), label: c.help },
    ...(TELEGRAM_URL ? [{ href: TELEGRAM_URL, label: 'Telegram', external: true }] : []),
    ...(signedIn ? [] : [{ href: '/sign-in', label: c.signIn }]),
  ];
  const primary: Item = signedIn ? { href: '/dashboard', label: c.backToApp } : { href: '/sign-up', label: c.signUp };
  const primaryShort: Item = { ...primary, label: signedIn ? c.backToAppShort : c.signUpShort };

  return (
    <header className="border-b border-lp-line bg-lp-base">
      <div className={`${CONTAINER} flex min-h-[4.25rem] items-center justify-between gap-x-4 py-2`}>
        <Link href="/" className="shrink-0 rounded-lp text-[18px] font-bold tracking-[-0.02em] text-lp-ink sm:text-[20px]">
          <TasnivoLogo markClassName="size-6 sm:size-7" accent="var(--color-lp-brand)" />
        </Link>
        <nav aria-label={c.nav} className="hidden md:ml-auto md:block">
          <ul className="-mr-1 flex items-center gap-x-1">
            {items.map((item) => (
              <li key={item.href}><ItemLink item={item} className={`${NAV_LINK} ${item.strong ? 'font-medium text-lp-ink' : ''}`} /></li>
            ))}
            <li className="ml-2"><ItemLink item={primary} className={PRIMARY} /></li>
          </ul>
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          <ItemLink item={primaryShort} className={PRIMARY} />
          <details className="relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lp border border-lp-line-strong px-3 text-[15px] text-lp-ink [&::-webkit-details-marker]:hidden">
              {c.menu}
            </summary>
            <nav aria-label={c.nav} className="absolute right-0 top-full z-40 mt-3 w-64 rounded-lp border border-lp-line bg-lp-base p-2 shadow-lg">
              <ul>{items.map((item) => <li key={item.href}><ItemLink item={item} className={MENU_LINK} /></li>)}</ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
