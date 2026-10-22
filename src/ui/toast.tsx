'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';
import { IconButton } from './icon-button';
import { IconError, IconSuccess, IconX } from './icons';
import { remainingMs, toastDuration, type ToastTone } from './toast-timing';

type Action = { label: string; run: () => void };
type Toast = { id: number; message: string; action?: Action; tone: ToastTone };
type Push = (message: string, opts?: { action?: Action; tone?: ToastTone }) => void;

const Ctx = createContext<Push>(() => undefined);

export const useToast = (): Push => useContext(Ctx);

/** One toast: its own timer, paused while it is hovered or holds focus. */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { ta } = useI18n();
  const [paused, setPaused] = useState(false);
  const left = useRef(toastDuration(toast.tone, Boolean(toast.action)));

  useEffect(() => {
    if (paused) return;
    const deadline = Date.now() + left.current;
    const timer = setTimeout(() => onDismiss(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = remainingMs(deadline, Date.now());
    };
  }, [paused, onDismiss, toast.id]);

  const error = toast.tone === 'error';
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onDismiss(toast.id);
  };

  return (
    <div
      className={cx(
        'pointer-events-auto flex w-[min(28rem,calc(100vw-2rem))] items-start gap-3 rounded-md border bg-raised py-2.5 pl-3 pr-1.5 text-data text-fg shadow-overlay motion-safe:animate-pop-in',
        error ? 'border-danger' : 'border-line-strong',
      )}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
      onKeyDown={onKeyDown}
    >
      <span className={cx('mt-0.5 shrink-0', error ? 'text-danger-ink' : 'text-good-ink')}>
        {error ? <IconError size={16} /> : <IconSuccess size={16} />}
      </span>
      <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 py-0.5">
        {error ? <span className="font-semibold text-danger-ink">{ta.shellX.ui.error}: </span> : null}
        {toast.message}
      </p>
      {toast.action ? (
        <button
          type="button"
          onClick={() => { toast.action?.run(); onDismiss(toast.id); }}
          className="shrink-0 rounded-sm px-2 py-0.5 font-semibold text-brand-ink hover:bg-brand-tint"
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton label={ta.shell.close} icon={<IconX size={16} />} size="compact" onClick={() => onDismiss(toast.id)} className="-my-1" />
    </div>
  );
}

/**
 * Bottom-left stack of at most three toasts. Confirmations are announced politely; errors are
 * role="alert" with an "Error:" prefix. A toast with an action (Undo) stays at least 5 s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((message, opts) => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, message, action: opts?.action, tone: opts?.tone ?? 'ok' }]);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 left-4 z-toast flex flex-col items-start gap-2">
        {/* The polite region exists before any toast, so screen readers hear additions; errors carry role="alert". */}
        <div aria-live="polite" className="flex flex-col items-start gap-2">
          {items.filter((x) => x.tone !== 'error').map((x) => <ToastItem key={x.id} toast={x} onDismiss={dismiss} />)}
        </div>
        <div className="flex flex-col items-start gap-2">
          {items.filter((x) => x.tone === 'error').map((x) => <ToastItem key={x.id} toast={x} onDismiss={dismiss} />)}
        </div>
      </div>
    </Ctx.Provider>
  );
}
