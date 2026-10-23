'use client';

import { forwardRef, useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';
import { Input, type InputProps } from './input';
import { IconEye, IconEyeOff } from './icons';

type Props = Omit<InputProps, 'type' | 'trailing' | 'trailingIcon'>;

/**
 * Password field with a show/hide toggle at its end. The toggle is a real button (its name says
 * what it does, aria-pressed says the state) and never submits the form. Wrap in Field for a label.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput({ size = 'md', ...rest }, ref) {
  const { ta } = useI18n();
  const [shown, setShown] = useState(false);
  const label = shown ? ta.uiX.hidePassword : ta.uiX.showPassword;
  return (
    <Input
      ref={ref}
      size={size}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      {...rest}
      trailing={(
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={shown}
          aria-controls={rest.id}
          disabled={rest.disabled}
          onClick={() => setShown((v) => !v)}
          className={cx(
            'inline-flex items-center justify-center rounded-sm text-muted transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg',
            'disabled:cursor-not-allowed disabled:opacity-50',
            size === 'lg' ? 'size-8' : size === 'md' ? 'size-7' : 'size-6',
          )}
        >
          {shown ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      )}
    />
  );
});
