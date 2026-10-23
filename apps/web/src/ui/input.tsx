import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { controlClass, isInvalid, type ControlSize } from './control';
import { cx } from './cx';
import { IconAlert } from './icons';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: ControlSize;
  /** Red border and aria-invalid; pair it with an error message (Field does both). */
  invalid?: boolean;
  /** Decorative icon inside the field, before the text (a search glass, an envelope). */
  leadingIcon?: ReactNode;
  /** Decorative icon inside the field, after the text. */
  trailingIcon?: ReactNode;
  /** Interactive element at the end of the field (show password, clear); give it its own accessible name. */
  trailing?: ReactNode;
  /** Class for the wrapper that holds the icons (only rendered when an icon or trailing element is given). */
  wrapperClassName?: string;
};

// Room for an icon: 12px gutter, 16px icon, 8px gap (wider for the trailing button).
const PAD_START: Record<ControlSize, string> = { compact: 'pl-8', md: 'pl-9', lg: 'pl-10' };
const PAD_END: Record<ControlSize, string> = { compact: 'pr-8', md: 'pr-9', lg: 'pr-10' };
const PAD_END_BUTTON: Record<ControlSize, string> = { compact: 'pr-9', md: 'pr-10', lg: 'pr-11' };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', invalid, leadingIcon, trailingIcon, trailing, wrapperClassName, ...rest },
  ref,
) {
  const bad = isInvalid(invalid, rest['aria-invalid']);
  const padding = cx(leadingIcon ? PAD_START[size] : null, trailing ? PAD_END_BUTTON[size] : trailingIcon ? PAD_END[size] : null);
  const field = <input ref={ref} className={controlClass(size, { invalid: bad, readOnly: rest.readOnly }, cx(padding, className))} {...rest} aria-invalid={bad || undefined} />;
  if (!leadingIcon && !trailingIcon && !trailing) return field;
  return (
    <span className={cx('relative block', wrapperClassName)}>
      {leadingIcon ? <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 inline-flex -translate-y-1/2 text-subtle">{leadingIcon}</span> : null}
      {field}
      {trailing ? <span className="absolute right-1 top-1/2 inline-flex -translate-y-1/2">{trailing}</span>
        : trailingIcon ? <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 text-subtle">{trailingIcon}</span> : null}
    </span>
  );
});

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean };

type FieldProps = {
  label: string;
  hint?: string;
  /** Shown under the control in red with an icon, and linked to it with aria-describedby. */
  error?: string;
  required?: boolean;
  className?: string;
  /** One control (Input, Select, Textarea); it receives the id and the description links. */
  children: ReactNode;
  /** Small element at the right end of the label row (a "Forgot password?" link, a counter). */
  labelAside?: ReactNode;
};

/** Label above a control, hint and error below, all linked by id. */
export function Field({ label, hint, error, required, className, children, labelAside }: FieldProps) {
  const auto = useId();
  if (!isValidElement<ControlProps>(children)) {
    return (
      <label className={cx('block', className)}>
        <span className="mb-1.5 block text-data font-medium text-fg">{label}</span>
        {children}
        {hint ? <span className="mt-1.5 block text-small text-muted">{hint}</span> : null}
      </label>
    );
  }
  const control = children;
  const id = control.props.id ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = cx(control.props['aria-describedby'], hintId, errorId) || undefined;
  const extra: ControlProps = { id, 'aria-describedby': describedBy };
  if (error) extra['aria-invalid'] = true;
  return (
    <div className={cx('block', className)}>
      {labelAside ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="block text-data font-medium text-fg">
            {label}
            {required ? <span aria-hidden className="text-danger-ink"> *</span> : null}
          </label>
          <span className="shrink-0 text-data">{labelAside}</span>
        </div>
      ) : (
        <label htmlFor={id} className="mb-1.5 block text-data font-medium text-fg">
          {label}
          {required ? <span aria-hidden className="text-danger-ink"> *</span> : null}
        </label>
      )}
      {cloneElement(control, extra)}
      {hint ? <p id={hintId} className="mt-1.5 text-small text-muted">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1 text-small font-medium text-danger-ink">
          <IconAlert size={14} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
