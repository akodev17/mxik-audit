import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import { TableFrame } from './table-frame';

type Props = {
  children: ReactNode;
  /** Names the scroll region for screen readers; with it an overflowing table can be scrolled from the keyboard. */
  label?: string;
  /** Keeps the header row visible while the body scrolls inside a region of maxHeight. */
  stickyHeader?: boolean;
  /** CSS length of the scroll region when stickyHeader is on; 70vh by default. */
  maxHeight?: string;
  className?: string;
  /** Row height: comfortable 40px (default) or compact 32px (§2). */
  density?: 'comfortable' | 'compact';
  /** Light hover on every body row (a reading aid on wide tables); Tr interactive adds it per row. */
  hoverRows?: boolean;
};

/** Plain data table: muted header, hairline rows, in a scroll frame that never widens the page. */
// Vertical cell padding per density, read by Th and Td: 18px data line + padding + 1px rule = 40 / 32.
const DENSITY = { comfortable: '[--cell-py:0.65625rem]', compact: '[--cell-py:0.40625rem]' } as const;

export function Table({ children, label, stickyHeader = false, maxHeight, className, density = 'comfortable', hoverRows = false }: Props) {
  return (
    <TableFrame label={label} stickyHeader={stickyHeader} maxHeight={maxHeight} className={className}>
      <table className={cx(
        'dense w-full min-w-full border-separate border-spacing-0 text-left',
        DENSITY[density],
        hoverRows && '[&_tbody_tr:hover]:bg-surface',
        '[&_tbody_tr:last-child>td]:border-b-0',
        stickyHeader && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-sticky',
      )}>
        {children}
      </table>
    </TableFrame>
  );
}

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean };
type TdProps = TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean };

/** Header cell: sentence case, muted; numeric columns align right. */
export function Th({ className, numeric, scope = 'col', ...rest }: ThProps) {
  return (
    <th
      scope={scope}
      className={cx('border-b border-line-strong bg-surface px-3 py-(--cell-py,0.5rem) text-small font-medium text-muted', numeric && 'text-right', className)}
      {...rest}
    />
  );
}

/** Body cell; numeric cells align right with tabular figures. */
export function Td({ className, numeric, ...rest }: TdProps) {
  return <td className={cx('border-b border-line px-3 py-(--cell-py,0.5rem) align-middle', numeric && 'whitespace-nowrap text-right tabular-nums', className)} {...rest} />;
}

type TrProps = HTMLAttributes<HTMLTableRowElement> & {
  /** The whole row responds to a click: hover highlight and pointer cursor. */
  interactive?: boolean;
  /** Tints the row; say it in text too (a checked checkbox), colour alone is not enough. */
  selected?: boolean;
};

/** Body row. Hover is shown only when the row itself is clickable. */
export function Tr({ className, interactive = false, selected = false, ...rest }: TrProps) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cx('transition-colors duration-(--duration-fast)', interactive && 'cursor-pointer hover:bg-surface', selected && 'bg-brand-tint hover:bg-brand-tint', className)}
      {...rest}
    />
  );
}
