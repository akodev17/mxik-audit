import type { ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from './breadcrumbs';
import { cx } from './cx';

/**
 * The page container: max-w-page (64rem: forms, settings, lists) or max-w-page-wide (80rem:
 * tables, dashboards). Positioned, so sr-only text inside can never widen or lengthen the page.
 */
export function pageContainerClass(wide = false): string {
  return cx('relative mx-auto w-full px-4 py-6 sm:px-6', wide ? 'max-w-page-wide' : 'max-w-page');
}

type Props = {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Ancestor pages, shown above the title; the title itself becomes the last crumb. */
  crumbs?: Crumb[];
};

/** Standard page body: optional breadcrumbs, title row with hint and actions, then content. */
export function Page({ title, hint, actions, children, wide, crumbs }: Props) {
  return (
    <div className={pageContainerClass(wide)}>
      {crumbs && crumbs.length > 0 ? <Breadcrumbs items={[...crumbs, { label: title }]} className="mb-2" /> : null}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-medium leading-9 tracking-tight">{title}</h1>
          {hint ? <p className="mt-1 max-w-2xl text-small text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Titled block inside a page. */
export function Section({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-section">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {hint ? <p className="mb-3 mt-0.5 max-w-2xl text-small text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}
