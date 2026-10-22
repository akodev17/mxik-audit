import { cx } from './cx';

/** A 17-digit classifier code in the mono face; it never breaks across lines. */
export function CodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-mono tabular-nums text-fg', className)}>
      {code}
    </span>
  );
}
