'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { finishTask } from '@/app/actions/reminders';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';

export type TaskItem = { id: string; clientId: string; clientName: string; dueOn: string; overdue: boolean };

/** Open monthly checks, earliest first. Closing one by hand is recorded in the audit log. */
export function Tasks({ items, canWrite }: { items: TaskItem[]; canWrite: boolean }) {
  const { ta, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function close(id: string): Promise<void> {
    setBusy(id);
    try {
      const result = await finishTask(id);
      if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
      toast(ta.firmX.home.taskClosed);
      router.refresh();
    } catch {
      toast(ta.shellX.ui.confirmFailed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <p className="text-small text-muted">{ta.firmX.home.tasksNone}</p>;
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
          <span className="min-w-0">
            <Link href={`/clients/${t.clientId}`} className="font-medium hover:text-brand-ink hover:underline">{t.clientName}</Link>
            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-muted">
              {ta.firmX.home.taskDue(fmtDate(locale, t.dueOn))}
              {t.overdue ? <StatusChip tone="danger" icon={<StatusIcon tone="danger" size={12} />}>{ta.reminders.overdue}</StatusChip> : null}
            </span>
          </span>
          {canWrite ? (
            <Button
              size="sm" variant="secondary" loading={busy === t.id} disabled={busy !== null && busy !== t.id} onClick={() => { void close(t.id); }}
              aria-label={`${ta.firmX.home.taskDone}: ${t.clientName}, ${ta.firmX.home.taskDue(fmtDate(locale, t.dueOn))}`}
            >
              {ta.firmX.home.taskDone}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
