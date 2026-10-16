'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, useTransition } from 'react';
import { reportWrongSuggestion } from '@/app/actions/feedback';
import { WRONG_REASONS } from '@/lib/wrong-reasons';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';

/** "Taklif notoʻgʻri": a reason and an optional note, recorded for the accuracy metrics. */
export function WrongFeedback({ findingId }: { findingId: string }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof WRONG_REASONS)[number]>('other_category');
  const [note, setNote] = useState('');
  const [busy, start] = useTransition();

  if (!open) return <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{ta.wrong.button}</Button>;
  return (
    <div className="space-y-2 rounded-ctl border border-line p-3">
      <p className="text-sm font-bold">{ta.wrong.title}</p>
      <fieldset className="space-y-1 text-sm">
        {WRONG_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name={`wrong-${findingId}`} checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--color-brand)]" />
            {ta.wrong.reasons[r]}
          </label>
        ))}
      </fieldset>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={ta.wrong.note} className="w-full rounded-ctl border border-line-strong p-2 text-sm focus:border-brand focus:outline-none" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => {
          const result = await reportWrongSuggestion({ findingId, reason, note });
          toast(result.ok ? ta.wrong.thanks : ta.ws.failedToast, result.ok ? undefined : { tone: 'error' });
          if (result.ok) setOpen(false);
        })}>{ta.wrong.send}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{ta.wrong.cancel}</Button>
      </div>
    </div>
  );
}
