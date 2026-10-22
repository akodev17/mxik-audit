'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Checkbox } from '@/ui/checkbox';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';
import type { Account } from './brand-form';

/** Admin: accept dictionary matches automatically. Goes back to the saved value when saving fails. */
export function DictionarySetting({ initial }: { initial: Account }) {
  const { ta } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useSeededQuery(api.account.get, initial);
  const [on, setOn] = useState(data.dictAutoAccept);
  const save = useMutation({
    mutationFn: (next: boolean) => api.dictionary.setAutoAccept({ on: next }).catch(() => ({ ok: false })),
    onSuccess: async (result, next) => {
      if (!result.ok) {
        setOn(!next);
        toast(ta.setX.account.dictFailed, { tone: 'error' });
        return;
      }
      toast(ta.setX.account.dictSaved);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.account.get) });
    },
  });

  const change = (next: boolean): void => {
    setOn(next);
    save.mutate(next);
  };

  return (
    <div className="flex items-start gap-2">
      <Checkbox checked={on} disabled={save.isPending} onChange={(e) => change(e.target.checked)} label={ta.dict.autoLabel} description={ta.dict.autoHint} />
      {save.isPending ? <Spinner size={14} /> : null}
    </div>
  );
}
