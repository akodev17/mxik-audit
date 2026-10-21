import Link from 'next/link';
import { helpPath } from '@/lib/help';
import { TasnivoLogo } from '@/ui/logo';
import { DEMO_URL, TELEGRAM_URL } from './config';
import { CONTAINER } from './container';
import { SHELL_COPY, type SiteLang } from './shell-copy';

const NAV_LINK = 'rounded-lp px-3 py-2 text-[15px] font-medium text-lp-muted transition-colors hover:bg-lp-surface hover:text-lp-ink';
const PRIMARY = 'inline-flex min-h-10 items-center whitespace-nowrap rounded-lp bg-lp-brand px-4 text-[15px] font-medium text-white shadow-sm transition-colors hover:bg-lp-brand-ink';
const SECONDARY = 'inline-flex min-h-10 items-center whitespace-nowrap rounded-lp border border-lp-line bg-lp-surface px-4 text-[15px] font-medium text-lp-ink transition-colors hover:border-lp-line-strong';
const MENU_LINK = 'block rounded-lp px-3 py-2.5 text-[16px] text-lp-ink hover:bg-lp-surface';

type Item = { href: string; label: string; external?: boolean };

function ItemLink({ item, className }: { item: Item; className: string }) {
  if (item.external) return <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>{item.label}</a>;
  return <Link href={item.href} className={className}>{item.label}</Link>;
}

// Brand, a few section links, sign-in and one primary action: sign up, or back to the app for a
// signed-in reader. Below md the links fold into a menu so the primary action stays on the first row.
// Anchors start with "/" so they also work from the help centre and the legal pages.
export function SiteHeader({ lang = 'uz', signedIn = false }: { lang?: SiteLang; signedIn?: boolean }) {
  const c = SHELL_COPY[lang];
  const links: Item[] = [
    { href: '/#qanday-ishlaydi', label: c.how },
    { href: '/#narxlar', label: c.pricing },
    { href: '/#savollar', label: c.faq },
    { href: helpPath(lang), label: c.help },
    ...(DEMO_URL ? [{ href: DEMO_URL, label: c.demo }] : []),
    ...(TELEGRAM_URL ? [{ href: TELEGRAM_URL, label: 'Telegram', external: true }] : []),
  ];
  const signIn: Item | null = signedIn ? null : { href: '/sign-in', label: c.signIn };
  const primary: Item = signedIn ? { href: '/dashboard', label: c.backToApp } : { href: '/sign-up', label: c.signUp };
  const primaryShort: Item = { ...primary, label: signedIn ? c.backToAppShort : c.signUpShort };

  return (
    <header className="bg-lp-base">
      <div className={`${CONTAINER} flex min-h-[4.5rem] items-center gap-x-6 py-3`}>
        <Link href="/" className="shrink-0 rounded-lp text-[18px] font-bold tracking-[-0.02em] text-lp-ink sm:text-[20px]">
          <TasnivoLogo markClassName="size-6 sm:size-7" accent="var(--color-lp-brand)" />
        </Link>
        <nav aria-label={c.nav} className="hidden lg:block">
          <ul className="flex items-center gap-x-1">
            {links.map((item) => <li key={item.href}><ItemLink item={item} className={NAV_LINK} /></li>)}
          </ul>
        </nav>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          {signIn ? <ItemLink item={signIn} className={SECONDARY} /> : null}
          <ItemLink item={primary} className={PRIMARY} />
        </div>
        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <ItemLink item={primaryShort} className={PRIMARY} />
          <details className="relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lp border border-lp-line bg-lp-surface px-3 text-[15px] font-medium text-lp-ink [&::-webkit-details-marker]:hidden">
              {c.menu}
            </summary>
            <nav aria-label={c.nav} className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lp-lg border border-lp-line bg-lp-base p-2 shadow-lg">
              <ul>
                {links.map((item) => <li key={item.href}><ItemLink item={item} className={MENU_LINK} /></li>)}
                {signIn ? <li><ItemLink item={signIn} className={`${MENU_LINK} font-medium`} /></li> : null}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
