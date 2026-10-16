'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { finishTask } from '@/app/actions/reminders';
import { formatTagOf, useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

export type TaskItem = { id: string; clientId: string; clientName: string; dueOn: string; overdue: boolean };

/** Open monthly checks, overdue first. */
export function Tasks({ items, canWrite }: { items: TaskItem[]; canWrite: boolean }) {
  const { ta, locale } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  if (items.length === 0) return <p className="text-sm text-muted">{ta.reminders.none}</p>;
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line text-sm">
      {items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <span>
            <Link href={`/clients/${t.clientId}`} className="font-medium hover:text-brand">{t.clientName}</Link>
            <span className="ml-3 text-muted">{new Date(t.dueOn).toLocaleDateString(formatTagOf(locale))}</span>
            {t.overdue ? <Badge tone="danger" className="ml-2">{ta.reminders.overdue}</Badge> : null}
          </span>
          {canWrite ? <Button size="sm" disabled={busy} onClick={() => start(async () => { await finishTask(t.id); router.refresh(); })}>{ta.reminders.done}</Button> : null}
        </li>
      ))}
    </ul>
  );
}
