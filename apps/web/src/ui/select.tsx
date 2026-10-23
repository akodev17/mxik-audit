import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
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
  /** Decorative icon before the chosen option's text. */
  leadingIcon?: ReactNode;
};

/** Native select with the app's control look: keyboard, mobile pickers and forms work as usual. */
export const Select = forwardRef<HTMLSelectElement, Props>(function SelectControl(
  { size = 'md', invalid, label, hint, error, className, wrapperClassName, leadingIcon, children, ...rest },
  ref,
) {
  if (label) {
    return (
      <Field label={label} hint={hint} error={error} required={rest.required} className={wrapperClassName}>
        <Select ref={ref} size={size} invalid={invalid} className={className} leadingIcon={leadingIcon} {...rest}>{children}</Select>
      </Field>
    );
  }
  const bad = isInvalid(invalid, rest['aria-invalid']);
  return (
    <span className={cx('relative block', wrapperClassName)}>
      {leadingIcon ? <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 inline-flex -translate-y-1/2 text-subtle">{leadingIcon}</span> : null}
      <select
        ref={ref}
        className={controlClass(size, { invalid: bad }, cx('cursor-pointer appearance-none pr-8', leadingIcon ? (size === 'compact' ? 'pl-8' : size === 'md' ? 'pl-9' : 'pl-10') : null, className))}
        {...rest}
        aria-invalid={bad || undefined}
      >
        {children}
      </select>
      <IconChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
});
