'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';

type Activity = 'savdo' | 'ishlab_chiqarish' | 'boshqa';
const ACTIVITIES: Activity[] = ['savdo', 'ishlab_chiqarish', 'boshqa'];

/** The client's activity type as a card with its own save; a failed save keeps the choice and says so. */
export function ActivityForm({ clientId, activity }: { clientId: string; activity: Activity }) {
  const { t, ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState<Activity>(activity);
  const [value, setValue] = useState<Activity>(activity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.imports.setActivity({ clientId, activity: value });
      if (!result.ok) { setError(ta.firmX.errors.forbidden); return; }
      setSaved(value);
      toast(ta.firmX.client.activitySaved);
      router.refresh();
    } catch (e) {
      setError(refusalText(e, ta.shellX.ui.confirmFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t.activityLabel} as="h3"
      footer={<Button variant="primary" size="sm" loading={busy} disabled={value === saved && !busy} onClick={() => { void save(); }}>{ta.firmX.client.activitySave}</Button>}
    >
      <Select
        label={t.activityLabel} hint={t.activityHint} error={error ?? undefined}
        value={value} disabled={busy}
        onChange={(e) => { setValue(ACTIVITIES.find((a) => a === e.target.value) ?? 'boshqa'); setError(null); }}
      >
        {ACTIVITIES.map((a) => <option key={a} value={a}>{t.activityOptions[a]}</option>)}
      </Select>
    </Card>
  );
}
