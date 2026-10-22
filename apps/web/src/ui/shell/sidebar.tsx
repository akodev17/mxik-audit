'use client';

import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { cx } from '../cx';
import { TasnivoMark } from '../logo';
import { isActive } from './nav';
import type { NavGroupView } from './nav-items';
import { NavLink } from './nav-link';

/**
 * Grouped navigation with small headings; the last group (help and settings) sits at the bottom.
 * Used by the drawer that replaces the header tabs and the icon rail below md.
 */
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
                <p id={headingId} className={cx('px-2.5 pb-1 text-micro font-medium text-subtle', headingClass)}>
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
  return <TasnivoMark />;
}
