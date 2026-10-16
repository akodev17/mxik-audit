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
        <span className="font-medium">{t.activityLabel}:</span>
        <select
          value={value} disabled={busy}
          onChange={(e) => {
            const next = ACTIVITIES.find((a) => a === e.target.value) ?? 'boshqa';
            setValue(next);
            start(async () => { await setActivity({ clientId, activity: next }); router.refresh(); });
          }}
          className="h-9 rounded-ctl border border-line-strong bg-base px-2 focus:border-brand focus:outline-none"
        >
          {ACTIVITIES.map((a) => <option key={a} value={a}>{t.activityOptions[a]}</option>)}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted">{t.activityHint}</p>
    </div>
  );
}
