import { cx } from './cx';

type Tone = 'brand' | 'good' | 'warn' | 'danger';

type Props = {
  /** Accessible name; shown above the bar unless hideLabel. */
  label: string;
  /** Omit for an indeterminate bar (no aria-valuenow). */
  value?: number;
  max?: number;
  /** Spoken and shown value, e.g. "120 / 400"; defaults to the rounded percentage. */
  valueText?: string;
  tone?: Tone;
  hideLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

const FILL: Record<Tone, string> = { brand: 'bg-brand', good: 'bg-good', warn: 'bg-warn', danger: 'bg-danger' };

/**
 * Track: a sunken well with a 1px line-input edge. The edge is >= 3:1 against surface, raised and
 * base in both themes (non-text contrast); a solid track that dark would hide the fill's end, while
 * the brand, good and danger fills stay >= 3:1 on the well. Both are checked in progress.test.ts.
 */
export const TRACK = { well: 'sunken', edge: 'line-input' } as const;
export const TRACK_CLASS = 'bg-sunken inset-ring inset-ring-line-input';

/** Whole percent of value in 0..max, clamped to 0..100; 0 for an empty range. */
export function progressPercent(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

/** Share of a task done, for example rows reviewed; role=progressbar with its range. */
export function Progress({ label, value, max = 100, valueText, tone = 'brand', hideLabel = false, size = 'md', className }: Props) {
  const known = value !== undefined && max > 0;
  const pct = known ? progressPercent(value, max) : 0;
  const text = known ? (valueText ?? `${pct}%`) : undefined;
  return (
    <div className={cx('min-w-0', className)}>
      {hideLabel ? null : (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-small">
          <span className="truncate text-muted">{label}</span>
          {text ? <span className="shrink-0 font-medium tabular-nums text-fg">{text}</span> : null}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={known ? value : undefined}
        aria-valuetext={text}
        className={cx('w-full overflow-hidden rounded-full', TRACK_CLASS, size === 'sm' ? 'h-1.5' : 'h-2')}
      >
        <div
          className={cx('h-full rounded-full transition-[width] duration-(--duration-base) ease-standard', FILL[tone], known ? undefined : 'w-1/3 motion-safe:animate-pulse')}
          style={known ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
