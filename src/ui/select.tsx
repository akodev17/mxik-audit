import { forwardRef, type SelectHTMLAttributes } from 'react';
import { controlClass, isInvalid, type ControlSize } from './control';
import { cx } from './cx';
import { IconChevronDown } from './icons';
import { Field } from './input';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: ControlSize;
  invalid?: boolean;
  /** With a label the select comes wrapped in a Field (label, hint and error linked by id). */
  label?: string;
  hint?: string;
  error?: string;
  /** Class for the outer wrapper (width, margins); className styles the select itself. */
  wrapperClassName?: string;
};

/** Native select with the app's control look: keyboard, mobile pickers and forms work as usual. */
export const Select = forwardRef<HTMLSelectElement, Props>(function SelectControl(
  { size = 'md', invalid, label, hint, error, className, wrapperClassName, children, ...rest },
  ref,
) {
  if (label) {
    return (
      <Field label={label} hint={hint} error={error} required={rest.required} className={wrapperClassName}>
        <Select ref={ref} size={size} invalid={invalid} className={className} {...rest}>{children}</Select>
      </Field>
    );
  }
  const bad = isInvalid(invalid, rest['aria-invalid']);
  return (
    <span className={cx('relative block', wrapperClassName)}>
      <select
        ref={ref}
        className={controlClass(size, { invalid: bad }, cx('cursor-pointer appearance-none pr-8', className))}
        {...rest}
        aria-invalid={bad || undefined}
      >
        {children}
      </select>
      <IconChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
});
