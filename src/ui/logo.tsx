import { cx } from './cx';

// The Tasnivo mark: a "T" assembled from five records on a 3x2 grid, with one
// cell set apart in the brand colour — the record that has been checked.
// One source of truth: public/brand/*.svg and src/app/icon.svg use the same geometry.
const CELLS = [
  [0, 0], [10, 0], [20, 0], // the bar
  [10, 10],                 // the stem
] as const;
const CHECKED = [10, 20] as const;
const CHIP = [20, 10] as const; // the cell beside the stem, kept as the accent

type MarkProps = { className?: string; mono?: boolean; accent?: string };

/** Standalone symbol. Ink follows `currentColor`; the accent follows the brand token unless `mono`. */
export function TasnivoMark({ className, mono = false, accent }: MarkProps) {
  const accentFill = mono ? 'currentColor' : (accent ?? 'var(--color-brand, #2457f5)');
  return (
    <svg viewBox="0 0 28 28" aria-hidden focusable="false" className={cx('size-7 shrink-0', className)}>
      {CELLS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={8} height={8} rx={2} fill="currentColor" />)}
      <rect x={CHECKED[0]} y={CHECKED[1]} width={8} height={8} rx={2} fill="currentColor" />
      <rect x={CHIP[0]} y={CHIP[1]} width={8} height={8} rx={2} fill={accentFill} />
    </svg>
  );
}

/** Horizontal logo: symbol and wordmark. The wordmark is real text so it follows the page font and stays selectable. */
export function TasnivoLogo({ className, markClassName, mono, accent, label = 'Tasnivo' }: MarkProps & { markClassName?: string; label?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight', className)}>
      <TasnivoMark className={markClassName} mono={mono} accent={accent} />
      <span className="truncate">{label}</span>
    </span>
  );
}
