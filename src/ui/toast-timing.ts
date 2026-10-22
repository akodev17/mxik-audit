// How long a toast stays: long enough to read, and to reach its action with the keyboard.

export type ToastTone = 'ok' | 'error';

export const TOAST_MS = { ok: 4000, error: 10000, action: 5000 } as const;

export function toastDuration(tone: ToastTone, hasAction: boolean): number {
  const base = tone === 'error' ? TOAST_MS.error : TOAST_MS.ok;
  return hasAction ? Math.max(base, TOAST_MS.action) : base;
}

/** Time left on a running timer when it is paused; never negative. */
export function remainingMs(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}
