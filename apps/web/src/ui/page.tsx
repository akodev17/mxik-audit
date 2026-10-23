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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title">{title}</h1>
          {hint ? <p className="mt-1 max-w-2xl text-body text-muted">{hint}</p> : null}
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
      {hint ? <p className="mb-3 mt-0.5 max-w-2xl text-data text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

export type CardPadding = 'none' | 'sm' | 'md';

const CARD_PADDING: Record<CardPadding, string> = { none: '', sm: 'p-4', md: 'p-5' };

/**
 * The card surface: raised, hairline border, 12px radius, 20px padding (§2). For a surface that
 * is not a Card (a list, a form wrapper, a link tile); never nest one card inside another.
 */
export function cardClass(padding: CardPadding = 'md', extra?: string): string {
  return cx('relative rounded-lg border border-line bg-raised shadow-sm', CARD_PADDING[padding], extra);
}

type CardProps = {
  /** Card heading (h2 by default). */
  title?: string;
  /** One sentence under the title. */
  description?: ReactNode;
  /** Buttons or links at the right of the title row. */
  actions?: ReactNode;
  /** Bottom bar on the surface colour: the form's save button, a "see all" link. */
  footer?: ReactNode;
  children?: ReactNode;
  /** none: the body touches the edges (a table, a list with its own rows). */
  padding?: CardPadding;
  as?: 'section' | 'div' | 'article';
  headingAs?: 'h2' | 'h3';
  id?: string;
  className?: string;
};

/** A card with an optional header (title, description, actions) and footer, all on the same 20px rhythm. */
export function Card({ title, description, actions, footer, children, padding = 'md', as: Tag = 'section', headingAs: Heading = 'h2', id, className }: CardProps) {
  const hasHeader = Boolean(title || description || actions);
  const inset = padding === 'none' ? 'px-5' : '';
  return (
    <Tag id={id} className={cx(cardClass(padding, 'flex flex-col'), footer ? 'overflow-hidden' : null, className)}>
      {hasHeader ? (
        <div className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', inset, padding === 'none' ? 'py-4' : 'mb-4')}>
          <div className="min-w-0">
            {title ? <Heading className="text-section">{title}</Heading> : null}
            {description ? <div className="mt-0.5 text-data text-muted">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className={cx(
          'flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3',
          padding === 'md' ? '-mx-5 -mb-5 mt-5' : padding === 'sm' ? '-mx-4 -mb-4 mt-4 px-4' : '',
        )}>
          {footer}
        </div>
      ) : null}
    </Tag>
  );
}
