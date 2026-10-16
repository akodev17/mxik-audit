'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setDictAutoAccept } from '@/app/actions/dictionary';

export function DictionarySetting({ initial }: { initial: boolean }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, start] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox" checked={on} disabled={busy} className="mt-0.5 size-4 accent-[var(--color-brand)]"
        onChange={(e) => { const next = e.target.checked; setOn(next); start(async () => { await setDictAutoAccept(next); router.refresh(); }); }}
      />
      <span>
        <span className="block font-medium">{ta.dict.autoLabel}</span>
        <span className="block text-muted">{ta.dict.autoHint}</span>
      </span>
    </label>
  );
}
