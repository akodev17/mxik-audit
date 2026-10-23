'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cx } from './cx';

type Props = {
  /** The digits typed so far, at most `length` of them. */
  value: string;
  onChange: (value: string) => void;
  /** Called once all `length` digits are in (typed or pasted): e.g. submit the form. */
  onComplete?: (value: string) => void;
  length?: number;
  /** Accessible name of each box, e.g. (1, 6) => "Digit 1 of 6". */
  digitLabel: (n: number, total: number) => string;
  /** Id of the visible label of the whole group. */
  labelledBy?: string;
  /** Id of a hint or error under the group. */
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Posts the joined digits with the form under this name. */
  name?: string;
};

const digitsOnly = (s: string): string => s.replace(/\D/g, '');

/**
 * A one-time code in separate boxes: typing a digit moves to the next box, Backspace on an empty
 * box goes back, arrows move, and pasting (or the phone's SMS/authenticator autofill into the
 * first box) spreads the digits over the boxes. Each box has its own name; the group is labelled.
 */
export function OtpInput({ value, onChange, onComplete, length = 6, digitLabel, labelledBy, describedBy, invalid = false, disabled = false, autoFocus = false, name }: Props) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const group = useRef<HTMLDivElement>(null);
  const focus = (i: number): void => {
    const el = boxes.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };
  // Cleared from outside (a refused code) while the cursor is in a box: start again at the first one.
  useEffect(() => {
    if (value === '' && group.current?.contains(document.activeElement)) boxes.current[0]?.focus();
  }, [value]);
  const commit = (next: string): void => {
    const clean = digitsOnly(next).slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  /** Writes `typed` from box i on (several digits come from autofill or paste); never leaves a gap. */
  const writeAt = (i: number, typed: string): void => {
    const digits = digitsOnly(typed);
    if (!digits) return;
    const start = Math.min(i, value.length);
    const next = (value.slice(0, start) + digits + value.slice(start + digits.length)).slice(0, length);
    commit(next);
    focus(Math.min(start + digits.length, length - 1));
  };
  /** A box that already holds a digit receives old + new when the caret was not on it: keep the new one. */
  const typedInto = (i: number, raw: string): string => (raw.length === 2 && raw[0] === value[i] ? raw.slice(1) : raw);

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[i]) commit(value.slice(0, i) + value.slice(i + 1));
      else if (i > 0) { commit(value.slice(0, i - 1) + value.slice(i)); focus(i - 1); }
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
    else if (e.key === 'Home') { e.preventDefault(); focus(0); }
    else if (e.key === 'End') { e.preventDefault(); focus(length - 1); }
  };
  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    writeAt(i, e.clipboardData.getData('text'));
  };

  return (
    <div ref={group} role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex gap-2 sm:gap-2.5">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={digitLabel(i + 1, length)}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          // The first box takes a whole autofilled code; the others hold one digit.
          maxLength={i === 0 ? length : 1}
          autoFocus={autoFocus && i === 0}
          value={value[i] ?? ''}
          onChange={(e) => writeAt(i, typedInto(i, e.target.value))}
          onKeyDown={onKeyDown(i)}
          onPaste={onPaste(i)}
          onFocus={(e) => e.target.select()}
          className={cx(
            'h-12 w-full min-w-0 rounded-md border bg-raised text-center font-mono text-[1.25rem] font-medium tabular-nums text-fg',
            'transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:bg-sunken',
            invalid ? 'border-danger' : 'border-line-input hover:border-muted',
          )}
        />
      ))}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
