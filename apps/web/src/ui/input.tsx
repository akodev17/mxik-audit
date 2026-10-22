import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { controlClass, isInvalid, type ControlSize } from './control';
import { cx } from './cx';
import { IconAlert } from './icons';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: ControlSize;
  /** Red border and aria-invalid; pair it with an error message (Field does both). */
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size = 'md', invalid, ...rest }, ref) {
  const bad = isInvalid(invalid, rest['aria-invalid']);
  return <input ref={ref} className={controlClass(size, { invalid: bad, readOnly: rest.readOnly }, className)} {...rest} aria-invalid={bad || undefined} />;
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
};

/** Label above a control, hint and error below, all linked by id. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const auto = useId();
  if (!isValidElement<ControlProps>(children)) {
    return (
      <label className={cx('block', className)}>
        <span className="mb-1 block text-small font-medium text-fg">{label}</span>
        {children}
        {hint ? <span className="mt-1 block text-micro text-muted">{hint}</span> : null}
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
      <label htmlFor={id} className="mb-1 block text-small font-medium text-fg">
        {label}
        {required ? <span aria-hidden className="text-danger-ink"> *</span> : null}
      </label>
      {cloneElement(control, extra)}
      {hint ? <p id={hintId} className="mt-1 text-micro text-muted">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="mt-1 flex items-start gap-1 text-micro font-medium text-danger-ink">
          <IconAlert size={14} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
