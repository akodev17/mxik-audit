'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { buttonClass } from './button';
import { controlClass, type ControlSize } from './control';
import { cx } from './cx';
import { IconCheck, IconCopy } from './icons';

type Props = {
  /** Visible label of the field. */
  label: string;
  value: string;
  /** Monospace for codes, keys and tokens. */
  mono?: boolean;
  size?: Exclude<ControlSize, 'lg'>;
  className?: string;
};

type State = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/** Copies through the Clipboard API, falling back to selecting the text for in-app browsers that block it. */
async function copyText(input: HTMLInputElement, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input.select();
    return document.execCommand('copy');
  }
}

/** Read-only value with a copy button; the result is announced through a polite live region. */
export function CopyField({ label, value, mono = false, size = 'md', className }: Props) {
  const { ta } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async (): Promise<void> => {
    if (!input.current) return;
    setState((await copyText(input.current, value)) ? 'copied' : 'failed');
  };

  const status = state === 'copied' ? ta.shellX.ui.copied : state === 'failed' ? ta.shellX.ui.copyFailed : '';
  return (
    <div className={cx('relative', className)}>
      <label htmlFor={id} className="mb-1 block text-small font-medium text-fg">{label}</label>
      <div className="flex gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={controlClass(size, { readOnly: true }, cx('min-w-0 flex-1', mono && 'font-mono'))}
        />
        <button type="button" onClick={() => { void copy(); }} className={buttonClass('secondary', size === 'compact' ? 'sm' : 'md')}>
          {state === 'copied' ? <IconCheck size={16} className="text-good-ink" /> : <IconCopy size={16} />}
          {state === 'copied' ? ta.shellX.ui.copied : ta.shellX.ui.copy}
        </button>
      </div>
      <p aria-live="polite" className={state === 'failed' ? 'mt-1 text-micro text-danger-ink' : 'sr-only'}>{status}</p>
    </div>
  );
}
