'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { MINUTES_PER_DECISION } from '@tasnivo/contracts/modules/account';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';
import type { Account } from './brand-form';

const { min, max } = MINUTES_PER_DECISION;

/** A whole number of minutes inside the bounds, or null. The server checks the same bounds. */
export function readMinutes(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

/** Admin: the minutes one decision would take by hand, behind the dashboard's "time saved" estimate (D8). */
export function MinutesSetting({ initial }: { initial: Account }) {
  const { ta } = useI18n();
  const s = ta.setX.account;
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useSeededQuery(api.account.get, initial);
  const [text, setText] = useState(String(data.minutesPerDecision));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (minutes: number) => api.account.setMinutesPerDecision({ minutes }).catch(() => false),
    onSuccess: async (ok) => {
      if (!ok) {
        toast(s.dictFailed, { tone: 'error' });
        return;
      }
      toast(s.minutesSaved);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.account.get) });
    },
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const minutes = readMinutes(text);
    if (minutes === null) {
      setError(s.minutesBounds(min, max));
      return;
    }
    setError(null);
    save.mutate(minutes);
  };

  return (
    <Card id="minutes" title={s.minutesTitle} hint={s.minutesHint}>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Field label={s.minutesLabel} error={error ?? undefined} className="w-56">
          <Input size="lg" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} min={min} max={max} />
        </Field>
        <Button type="submit" size="lg" variant="secondary" loading={save.isPending}>{s.minutesSave}</Button>
      </form>
    </Card>
  );
}
