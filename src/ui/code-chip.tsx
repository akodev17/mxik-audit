import { cx } from './cx';

/** A 17-digit classifier code; the only place monospace is used. */
export function CodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cx('inline-block whitespace-nowrap rounded bg-surface px-1.5 py-0.5 font-mono text-xs tracking-tight text-fg', className)}>
      {code}
    </span>
  );
}
