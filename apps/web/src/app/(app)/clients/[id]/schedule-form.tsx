'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { refusalText } from '@/lib/api/refusal';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { nextReminderDate, skipsThisMonth } from '@/lib/pure/reminder-dates';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';

type Props = {
  clientId: string;
  initial: { dayOfMonth: number; assigneeId: string | null; enabled: boolean; lastPeriod: string | null } | null;
  people: { id: string; email: string }[];
};

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** The client's monthly check day and who gets reminded, as a card with its own save; the day and person wait until reminders are on. */
export function ScheduleForm({ clientId, initial, people }: Props) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.reminders;
  const router = useRouter();
  const toast = useToast();
  const [day, setDay] = useState(initial?.dayOfMonth ?? 5);
  const [assignee, setAssignee] = useState(initial?.assigneeId ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastPeriod = initial?.lastPeriod ?? null;
  const dirty = !initial
    ? enabled
    : day !== initial.dayOfMonth || (assignee || null) !== initial.assigneeId || enabled !== initial.enabled;
  const skip = skipsThisMonth({ dayOfMonth: day, enabled }, lastPeriod);
  const nextDue = nextReminderDate({ dayOfMonth: day, enabled, lastPeriod });

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.reminders.saveSchedule({ clientId, dayOfMonth: day, assigneeId: assignee || null, enabled });
      if (!result.ok) { setError(result.error); return; }
      toast(result.nextDue ? `${words.saved} ${words.next(fmtDate(locale, result.nextDue))}` : words.saved);
      router.refresh();
    } catch (e) {
      setError(refusalText(e, ta.shellX.ui.confirmFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={ta.reminders.title} hint={ta.reminders.hint} as="h3"
      footer={<Button variant="primary" size="sm" loading={busy} disabled={!dirty && !busy} onClick={() => { void save(); }}>{words.save}</Button>}
    >
      <div className="space-y-4">
        <Checkbox label={ta.reminders.enable} checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setError(null); }} disabled={busy} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Select label={ta.reminders.day.replace(/:$/, '')} value={day} disabled={!enabled || busy} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select label={ta.reminders.assignee.replace(/:$/, '')} value={assignee} disabled={!enabled || busy} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{ta.reminders.assigned}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
          </Select>
        </div>
        <p className="text-small text-muted">
          {enabled ? <>{skip ? `${words.skip(day)} ` : ''}{nextDue ? words.next(fmtDate(locale, nextDue)) : null}</> : words.offNote}
        </p>
        {error ? <p role="alert" className="text-small font-medium text-danger-ink">{error}</p> : null}
      </div>
    </Card>
  );
}
