'use client';

import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { WRONG_REASONS } from '@tasnivo/contracts';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { Dialog } from '@/ui/dialog';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';

/** "Taklif notoʻgʻri": a reason and an optional note in a dialog, recorded for the accuracy metrics. */
export function WrongFeedback({ findingId }: { findingId: string }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof WRONG_REASONS)[number]>('other_category');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = `wrong-${findingId}`;

  async function send(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.workspace.wrongSuggestion({ findingId, reason, note });
      if (!result.ok) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      toast(ta.wrong.thanks);
      setOpen(false);
      setNote('');
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button variant="ghost" size="sm" aria-describedby={`wrong-hint-${findingId}`} onClick={() => setOpen(true)}>{ta.wrong.button}</Button>
      <span id={`wrong-hint-${findingId}`} className="max-w-xs text-micro text-muted">{ta.wsX.drawer.wrongHint}</span>
      <Dialog
        open={open} onClose={() => setOpen(false)} title={ta.wrong.title} description={ta.wsUi.drawer.wrongDescription} size="sm" dismissible={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{ta.wrong.cancel}</Button>
            <Button type="submit" form={formId} variant="primary" loading={busy}>{ta.wrong.send}</Button>
          </>
        )}
      >
        <form id={formId} className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <fieldset className="space-y-1.5">
            <legend className="sr-only">{ta.wrong.title}</legend>
            {WRONG_REASONS.map((r) => (
              <label
                key={r}
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-data transition-colors duration-(--duration-fast)',
                  reason === r ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line hover:bg-surface',
                )}
              >
                <input type="radio" name={formId} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-[var(--color-brand)]" />
                {ta.wrong.reasons[r]}
              </label>
            ))}
          </fieldset>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={ta.wrong.note} aria-label={ta.wrong.note} />
        </form>
      </Dialog>
    </span>
  );
}
