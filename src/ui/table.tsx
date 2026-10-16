import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cx } from './cx';

/** Plain data table: grey header, hairline rows, square cells. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-ctl border border-line">
      <table className="dense min-w-full text-left">{children}</table>
    </div>
  );
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cx('border-b border-line-strong bg-surface px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-muted', className)} {...rest} />;
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('border-b border-line px-3 py-2.5 align-middle', className)} {...rest} />;
}
