import { cx } from './cx';

type Props = {
  /** Announced to screen readers; omit when the surrounding control already says it is busy. */
  label?: string;
  size?: number;
  className?: string;
};

/** Indeterminate activity mark in the current text colour. */
export function Spinner({ label, size = 16, className }: Props) {
  const mark = (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false" className={cx('shrink-0 animate-spin', className)}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
  if (!label) return mark;
  return (
    <span role="status" className="relative inline-flex items-center">
      {mark}
      <span className="sr-only">{label}</span>
    </span>
  );
}
