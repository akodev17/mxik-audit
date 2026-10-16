'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSchedule } from '@/app/actions/reminders';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

type Props = {
  clientId: string;
  initial: { dayOfMonth: number; assigneeId: string | null; enabled: boolean } | null;
  people: { id: string; email: string }[];
};

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** The client's monthly check day and who gets reminded. */
export function ScheduleForm({ clientId, initial, people }: Props) {
  const { ta } = useI18n();
  const router = useRouter();
  const [day, setDay] = useState(initial?.dayOfMonth ?? 5);
  const [assignee, setAssignee] = useState(initial?.assigneeId ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const select = 'h-9 rounded-ctl border border-line-strong bg-base px-2 text-sm';

  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} className="size-4 accent-[var(--color-brand)]" />{ta.reminders.enable}</label>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">{ta.reminders.day}
          <select value={day} onChange={(e) => { setDay(Number(e.target.value)); setSaved(false); }} className={select}>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </label>
        <label className="flex items-center gap-2">{ta.reminders.assignee}
          <select value={assignee} onChange={(e) => { setAssignee(e.target.value); setSaved(false); }} className={select}>
            <option value="">{ta.reminders.assigned}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
          </select>
        </label>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => start(async () => { setSaved(await saveSchedule({ clientId, dayOfMonth: day, assigneeId: assignee || null, enabled })); router.refresh(); })}>{ta.reminders.save}</Button>
        {saved ? <span className="text-good">{ta.dict.saved}</span> : null}
      </div>
      <p className="text-xs text-muted">{ta.reminders.hint}</p>
    </div>
  );
}
