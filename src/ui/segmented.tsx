'use client';

import { useId, type ReactNode } from 'react';
import { cx } from './cx';

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: ReactNode };

type Props<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Form field name; defaults to a generated one. */
  name?: string;
  size?: 'compact' | 'md';
  disabled?: boolean;
  className?: string;
};

/**
 * One choice out of a few, shown side by side. Native radios underneath: arrow keys move the
 * choice, Tab leaves the group, and the value posts with a form.
 */
export function Segmented<T extends string>({ label, options, value, onChange, name, size = 'compact', disabled = false, className }: Props<T>) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-ctl border border-line-strong bg-surface p-0.5', className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            'relative inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 font-medium text-muted',
            'transition-colors duration-(--duration-fast) hover:text-fg',
            'has-[:checked]:bg-raised has-[:checked]:text-fg has-[:checked]:shadow-sm',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
            'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
            // With the 2px inset and 1px border the group matches h-control-compact (32) or -md (36).
            size === 'compact' ? 'h-6.5 text-small' : 'h-7.5 text-data',
          )}
        >
          <input
            type="radio"
            name={group}
            value={o.value}
            checked={o.value === value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.icon}
          {o.label}
        </label>
      ))}
    </div>
  );
}
