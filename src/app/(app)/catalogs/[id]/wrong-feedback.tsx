'use client';

import { useState } from 'react';
import { reportWrongSuggestion } from '@/app/actions/feedback';
import { useI18n } from '@/lib/locale-client';
import { WRONG_REASONS } from '@/lib/wrong-reasons';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';

/** "Taklif notoʻgʻri": a reason and an optional note, recorded for the accuracy metrics. */
export function WrongFeedback({ findingId }: { findingId: string }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof WRONG_REASONS)[number]>('other_category');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(): Promise<void> {
    setBusy(true);
    try {
      const result = await reportWrongSuggestion({ findingId, reason, note });
      if (!result.ok) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      toast(ta.wrong.thanks);
      setOpen(false);
    } catch {
      toast(ta.wsX.toast.network, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{ta.wrong.button}</Button>;
  return (
    <form className="space-y-2 rounded-ctl border border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <fieldset className="space-y-1 text-small">
        <legend className="mb-1 font-semibold text-fg">{ta.wrong.title}</legend>
        {WRONG_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name={`wrong-${findingId}`} checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--color-brand)]" />
            {ta.wrong.reasons[r]}
          </label>
        ))}
      </fieldset>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={ta.wrong.note} aria-label={ta.wrong.note} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy}>{ta.wrong.send}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{ta.wrong.cancel}</Button>
      </div>
    </form>
  );
}
