'use client';

import { useCallback, type ComponentPropsWithRef, type ReactNode, type Ref } from 'react';
import { cx } from './cx';

type Props = Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> & {
  label: ReactNode;
  /** Second line under the label. */
  description?: ReactNode;
  /** Keeps the label for screen readers only (row selection in a table). */
  hideLabel?: boolean;
  /** Mixed state, e.g. "some rows selected"; announced as such. */
  indeterminate?: boolean;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/** Native checkbox in the brand colour, with its label; the whole label is the click target. */
export function Checkbox({ label, description, hideLabel = false, indeterminate = false, className, disabled, ref, ...rest }: Props) {
  const setRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.indeterminate = indeterminate;
    assignRef(ref, el);
  }, [indeterminate, ref]);

  return (
    <label className={cx('relative inline-flex items-start gap-2 text-data', disabled ? 'cursor-not-allowed text-muted' : 'cursor-pointer', className)}>
      <input
        ref={setRef}
        type="checkbox"
        disabled={disabled}
        className="mt-px size-4 shrink-0 cursor-[inherit] rounded-sm accent-brand"
        {...rest}
      />
      <span className={hideLabel ? 'sr-only' : 'min-w-0'}>
        <span className="block">{label}</span>
        {description ? <span className="mt-0.5 block text-small text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
