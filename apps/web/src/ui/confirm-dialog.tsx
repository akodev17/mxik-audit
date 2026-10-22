'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from './button';
import { Dialog } from './dialog';
import { IconAlert, IconError } from './icons';

export type ConfirmResult = void | { ok: true } | { ok: false; error?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** How many records the action touches; shown as "Affects N records" unless countLabel says it better. */
  count?: number;
  countLabel?: string;
  /** Where the action applies, e.g. a client and a catalogue name. */
  scope?: string;
  tone?: 'default' | 'danger';
  /** Says exactly what happens ("Delete 12 rows"), never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** May be async. Throwing or returning { ok: false } keeps the dialog open with the error shown inline. */
  onConfirm: () => Promise<ConfirmResult> | ConfirmResult;
};

/**
 * Asks before an action that is hard to undo. While the action runs the dialog cannot be dismissed;
 * it closes only on success. Danger confirmations start with focus on Cancel.
 */
export function ConfirmDialog({ open, onClose, title, description, count, countLabel, scope, tone = 'default', confirmLabel, cancelLabel, onConfirm }: Props) {
  const { locale, ta } = useI18n();
  const ui = ta.shellX.ui;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = tone === 'danger';

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await onConfirm();
      if (result && !result.ok) {
        setError(result.error ?? ui.confirmFailed);
        setBusy(false);
        return;
      }
      setBusy(false);
      onClose();
    } catch {
      setError(ui.confirmFailed);
      setBusy(false);
    }
  }

  const details = scope !== undefined || count !== undefined || error;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      role="alertdialog"
      size="sm"
      dismissible={!busy}
      initialFocus={danger ? cancelRef : confirmRef}
      icon={danger ? <IconAlert className="text-danger-ink" /> : undefined}
      footer={(
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel ?? ui.cancel}</Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} loading={busy} onClick={() => { void confirm(); }}>{confirmLabel}</Button>
        </>
      )}
    >
      {details ? (
        <div className="space-y-2 text-data">
          {scope !== undefined ? (
            <p><span className="text-muted">{ui.scope}: </span><span className="font-medium">{scope}</span></p>
          ) : null}
          {count !== undefined ? (
            <p className="font-medium tabular-nums">{countLabel ?? ui.affected(fmtNumber(locale, count), count)}</p>
          ) : null}
          {error ? (
            <p role="alert" className="flex items-start gap-1.5 rounded-ctl bg-danger-tint px-3 py-2 text-small font-medium text-danger-ink">
              <IconError size={16} className="mt-px shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
