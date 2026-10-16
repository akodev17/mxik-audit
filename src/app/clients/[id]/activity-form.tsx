'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setActivity } from '@/app/actions/purchases';
import { t } from '@/lib/i18n';

type Activity = 'savdo' | 'ishlab_chiqarish' | 'boshqa';
const ACTIVITIES: Activity[] = ['savdo', 'ishlab_chiqarish', 'boshqa'];

export function ActivityForm({ clientId, activity }: { clientId: string; activity: Activity }) {
  const router = useRouter();
  const [value, setValue] = useState<Activity>(activity);
  const [busy, start] = useTransition();
  return (
    <div className="text-sm">
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-ink-soft">{t.activityLabel}:</span>
        <select
          value={value} disabled={busy}
          onChange={(e) => {
            const next = ACTIVITIES.find((a) => a === e.target.value) ?? 'boshqa';
            setValue(next);
            start(async () => { await setActivity({ clientId, activity: next }); router.refresh(); });
          }}
          className="border border-rule bg-paper px-2 py-1 text-ink focus:border-ink focus:outline-none"
        >
          {ACTIVITIES.map((a) => <option key={a} value={a}>{t.activityOptions[a]}</option>)}
        </select>
      </label>
      <p className="mt-1 text-xs text-ink-faint">{t.activityHint}</p>
    </div>
  );
}
