'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { catalogKeys, failureText } from '@/lib/catalogs/client';
import type { ReviewView } from '@/lib/catalogs/types';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Popover } from '@/ui/popover';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';

const NOTE_MAX = 500;

export type ReviewState = {
  assigneeId: string;
  assigneeEmail: string;
  /** YYYY-MM-DD */
  dueOn: string | null;
  note: string | null;
  status: 'open' | 'done';
  overdue: boolean;
  doneAt: string | null;
};

type ReviewRead = { review: ReviewView | null; assignable: { id: string; email: string }[] };

/** The header's form of a review: the due day as YYYY-MM-DD. */
const stateOf = (v: ReviewView): ReviewState => ({
  assigneeId: v.assigneeId, assigneeEmail: v.assigneeEmail, dueOn: v.dueOn ? v.dueOn.slice(0, 10) : null, note: v.note,
  status: v.status, overdue: v.overdue, doneAt: v.doneAt,
});

type Props = {
  catalogId: string;
  /** catalogs.review as the server page read it. */
  initial: ReviewRead;
  /** The viewer may assign (a writer, outside a demo). */
  canAssign: boolean;
  /** Who is looking: an open review is closed by its assignee or an admin (who can also assign). */
  finisher: { userId: string; admin: boolean };
  /** Earliest selectable due date, YYYY-MM-DD (today in the org's time). */
  today: string;
};

/** The catalogue's review task: who has it, by when, and the form to hand it over or close it. */
export function ReviewControl({ catalogId, initial, canAssign, finisher, today }: Props) {
  const { ta, locale } = useI18n();
  const r = ta.review;
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = [...catalogKeys.one(catalogId), 'review'];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.catalogs.review({ catalogId }), initialData: initial, gcTime: 0 });
  const review = data.review ? stateOf(data.review) : null;
  const members = canAssign ? data.assignable : [];
  const canFinish = canAssign && review !== null && (finisher.admin || review.assigneeId === finisher.userId);
  const [open, setOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState(review?.assigneeId ?? '');
  const [dueOn, setDueOn] = useState(review?.dueOn ?? '');
  const [note, setNote] = useState(review?.note ?? '');
  const [doneNote, setDoneNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(job: () => Promise<{ ok: true; changed?: boolean } | { ok: false; error: string }>, success: (changed: boolean | undefined) => string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await job();
      if (!result.ok) { setError(result.error); return; }
      toast(success(result.changed), { tone: 'ok' });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(failureText(e, ta.wsX.toast.network));
    } finally {
      setBusy(false);
    }
  }

  const summary = !review
    ? <span className="text-muted">{r.none}</span>
    : (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="truncate" title={review.assigneeEmail}>{review.assigneeEmail}</span>
        {review.status === 'done'
          ? <Badge tone="good">{r.done}</Badge>
          : review.overdue ? <Badge tone="danger">{r.overdue}</Badge> : <Badge tone="info">{r.open}</Badge>}
        {review.dueOn && review.status === 'open' ? <span className="text-muted">{fmtDate(locale, review.dueOn)}</span> : null}
        {review.doneAt && review.status === 'done' ? <span className="text-muted">{fmtDate(locale, review.doneAt)}</span> : null}
      </span>
    );

  if (!canAssign && !(review && review.status === 'open' && canFinish)) return summary;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {summary}
      <Popover label={review ? r.change : r.assign} title={r.title} size="compact" open={open} onOpenChange={setOpen} panelClassName="w-[min(24rem,calc(100vw-2rem))]">
        <h3 className="text-section text-fg">{r.title}</h3>
        <p className="mt-1 text-micro text-muted">{r.hint}</p>
        {review?.note ? <p className="mt-2 rounded-ctl bg-sunken px-2 py-1.5 text-small text-muted">{review.note}</p> : null}
        {canAssign ? (
          members.length === 0 ? <p className="mt-3 text-small text-muted">{r.noMembers}</p> : (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.catalogs.assignReview({ catalogId, assigneeId, dueOn: dueOn || null, note: note.trim() || null }), (changed) => (changed === false ? r.unchanged : r.saved));
              }}
            >
              <Select label={r.assignee} size="compact" value={assigneeId} required onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="" disabled>{r.choose}</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </Select>
              <Field label={r.due}>
                <Input type="date" size="compact" value={dueOn} min={today} onChange={(e) => setDueOn(e.target.value)} />
              </Field>
              <Field label={r.note} hint={r.noteHint(NOTE_MAX)}>
                <Textarea rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!assigneeId}>{r.save}</Button>
            </form>
          )
        ) : null}
        {review && review.status === 'open' && canFinish ? (
          <form
            className="mt-4 space-y-2 border-t border-line pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.catalogs.finishReview({ catalogId, note: doneNote.trim() || null }), () => r.markedDone);
            }}
          >
            <Field label={r.doneNote}>
              <Textarea rows={2} maxLength={NOTE_MAX} value={doneNote} onChange={(e) => setDoneNote(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" variant="secondary" loading={busy}>{r.markDone}</Button>
          </form>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-small text-danger-ink">{error}</p> : null}
      </Popover>
    </span>
  );
}
