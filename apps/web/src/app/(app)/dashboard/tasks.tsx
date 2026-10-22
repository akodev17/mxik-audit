'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { api } from '@/lib/api/browser';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { serverChange } from '@/ui/shell/router-cache';

export type TaskItem = { id: string; clientId: string; clientName: string; dueOn: string; overdue: boolean };

/** Open monthly checks, earliest first. Closing one by hand is recorded in the audit log. */
export function Tasks({ items, canWrite }: { items: TaskItem[]; canWrite: boolean }) {
  const { ta, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Closed here: gone at once, before the refreshed page (with its new totals) arrives.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = items.filter((t) => !closed.has(t.id));

  async function close(id: string): Promise<void> {
    setBusy(id);
    try {
      const result = await serverChange(api.reminders.finishTask({ taskId: id }));
      if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
      setClosed((cur) => new Set(cur).add(id));
      toast(ta.firmX.home.taskClosed);
      // The dashboard is one server read: its totals (overdue checks) come with the refreshed page.
      router.refresh();
    } catch (error) {
      // A refusal (a demo, a viewer, a task already gone) carries the API's message in the user's language.
      toast(isApiError(error) && error.status >= 400 && error.status < 500 ? error.message : ta.shellX.ui.confirmFailed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (open.length === 0) return <p className="text-small text-muted">{ta.firmX.home.tasksNone}</p>;
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {open.map((t) => (
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
