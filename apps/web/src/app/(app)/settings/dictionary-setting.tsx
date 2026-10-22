'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, useTransition } from 'react';
import { api } from '@/lib/api/browser';
import { Checkbox } from '@/ui/checkbox';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';

/** Admin: accept dictionary matches automatically. Goes back to the saved value when saving fails. */
export function DictionarySetting({ initial }: { initial: boolean }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [busy, start] = useTransition();

  const change = (next: boolean): void => {
    setOn(next);
    start(async () => {
      const result = await api.dictionary.setAutoAccept({ on: next }).catch(() => ({ ok: false }));
      if (!result.ok) {
        setOn(!next);
        toast(ta.setX.account.dictFailed, { tone: 'error' });
        return;
      }
      toast(ta.setX.account.dictSaved);
    });
  };

  return (
    <div className="flex items-start gap-2">
      <Checkbox checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} label={ta.dict.autoLabel} description={ta.dict.autoHint} />
      {busy ? <Spinner size={14} /> : null}
    </div>
  );
}
