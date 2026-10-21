'use client';

import { useI18n } from '@/lib/locale-client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { cx } from '../cx';
import { TasnivoMark } from '../logo';
import { IconButton } from '../icon-button';
import { IconPanel } from './icons';
import { isActive } from './nav';
import { useNav, type NavGroupView } from './nav-items';
import { NavLink } from './nav-link';
import type { SidebarPref } from './prefs';

type Props = {
  id: string;
  pref: SidebarPref;
  /** What the rail shows right now (auto depends on the window width). */
  expanded: boolean;
  onToggle: () => void;
  canWrite: boolean;
  canTeam: boolean;
};

// Width and label visibility per preference; "auto" is collapsed from md to lg and expanded above.
const WIDTH: Record<SidebarPref, string> = { auto: 'w-14 lg:w-56', collapsed: 'w-14', expanded: 'w-56' };
const LABEL: Record<SidebarPref, string> = { auto: 'max-lg:sr-only', collapsed: 'sr-only', expanded: '' };
const WIDE_ONLY: Record<SidebarPref, string> = { auto: 'max-lg:hidden', collapsed: 'hidden', expanded: '' };
const RAIL_ONLY: Record<SidebarPref, string> = { auto: 'lg:hidden', collapsed: '', expanded: 'hidden' };
const TOGGLE_WRAP: Record<SidebarPref, string> = { auto: 'flex-1 justify-center lg:flex-none', collapsed: 'flex-1 justify-center', expanded: 'flex-none' };

/** Desktop navigation rail (md and up). Below md the same links open from the header menu button. */
export function Sidebar({ id, pref, expanded, onToggle, canWrite, canTeam }: Props) {
  const { t, ta } = useI18n();
  const groups = useNav(canWrite, canTeam);
  return (
    <nav
      id={id}
      aria-label={ta.shellX.nav.label}
      className={cx('no-print hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-(--duration-base) ease-standard md:flex', WIDTH[pref])}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-2">
        <Link href="/dashboard" aria-label={ta.shellX.nav.home} className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-ctl px-1.5 py-1', WIDE_ONLY[pref])}>
          <LogoMark />
          <span className="truncate text-section font-semibold tracking-tight">{t.appName}</span>
        </Link>
        <span className={cx('flex', TOGGLE_WRAP[pref])}>
          <IconButton
            label={expanded ? ta.shell.collapse : ta.shell.expand}
            icon={<IconPanel />}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={id}
            tooltipSide="bottom"
            tooltipAlign="start"
          />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        <NavGroups groups={groups} labelClass={LABEL[pref]} headingClass={WIDE_ONLY[pref]} dividerClass={RAIL_ONLY[pref]} />
      </div>
    </nav>
  );
}

/** Groups with headings; the last group (settings) sits at the bottom. Shared with the mobile menu. */
export function NavGroups({ groups, labelClass, headingClass, dividerClass, onNavigate }: {
  groups: NavGroupView[];
  labelClass?: string;
  headingClass?: string;
  dividerClass?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = useId();
  return (
    <div className="flex min-h-full flex-col gap-3 pt-1">
      {groups.map((g, i) => {
        const headingId = `${base}-${g.key}`;
        const last = i === groups.length - 1;
        return (
          <div key={g.key} className={cx(last && 'mt-auto')}>
            {g.label ? (
              <>
                <p id={headingId} className={cx('px-2.5 pb-1 text-micro font-semibold uppercase tracking-wide text-subtle', headingClass)}>
                  {g.label}
                </p>
                {i > 0 ? <hr aria-hidden className={cx('mx-2 mb-2 border-line', dividerClass ?? 'hidden')} /> : null}
              </>
            ) : (
              <hr aria-hidden className="mx-2 mb-2 border-line" />
            )}
            <ul aria-labelledby={g.label ? headingId : undefined} className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} labelClass={labelClass} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Small brand mark beside the product name. */
export function LogoMark() {
  return (
    <TasnivoMark />
  );
}
