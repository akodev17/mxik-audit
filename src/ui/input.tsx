import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-10 w-full rounded-ctl border border-line-strong bg-base px-3 text-[15px] text-fg placeholder:text-muted',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
