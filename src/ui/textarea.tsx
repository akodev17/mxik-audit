import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { controlSurface, isInvalid } from './control';
import { cx } from './cx';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

/** Multi-line text field; grows vertically by hand only. Wrap in Field for a label. */
export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
  const bad = isInvalid(invalid, rest['aria-invalid']);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={controlSurface({ invalid: bad, readOnly: rest.readOnly }, cx('min-h-control-lg resize-y py-2 text-data', className))}
      {...rest}
      aria-invalid={bad || undefined}
    />
  );
});
