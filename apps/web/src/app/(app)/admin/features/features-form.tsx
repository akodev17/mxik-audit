'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FEATURE_STATES, type FeatureState, type ModuleKey } from '@tasnivo/contracts/feature-modules';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../../_manage/card';

type Row = { key: ModuleKey; state: FeatureState };

/** One row per module with its three states as radios, saved together. */
export function FeaturesForm({ rows }: { rows: Row[] }) {
  const { ta } = useI18n();
  const a = ta.featuresX.admin;
  const toast = useToast();
  const router = useRouter();
  const [states, setStates] = useState(() => Object.fromEntries(rows.map((r) => [r.key, r.state])) as Record<ModuleKey, FeatureState>);
  const [saving, setSaving] = useState(false);
  const label: Record<FeatureState, string> = { ENABLED: a.enabled, COMING_SOON: a.comingSoon, HIDDEN: a.hidden };

  const save = async (): Promise<void> => {
    setSaving(true);
    const ok = await api.admin.setFeatures({ states }).then(() => true, () => false);
    setSaving(false);
    if (!ok) { toast(a.failed, { tone: 'error' }); return; }
    toast(a.saved);
    router.refresh();
  };

  return (
    <Card flush footer={<Button variant="primary" loading={saving} onClick={() => void save()}>{a.save}</Button>}>
      <Table label={a.title} className={FLUSH_TABLE}>
        <thead>
          <tr><Th>{a.module}</Th><Th>{a.state}</Th></tr>
        </thead>
        <tbody>
          {rows.map(({ key }) => (
            <tr key={key}>
              <Td>
                <span className="block font-medium">{ta.featuresX.modules[key].label}</span>
                <span className="block text-small text-muted">{ta.featuresX.modules[key].description}</span>
              </Td>
              <Td>
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="sr-only">{ta.featuresX.modules[key].label}</legend>
                  {FEATURE_STATES.map((state) => (
                    <label key={state} className="inline-flex cursor-pointer items-center gap-1.5 text-data">
                      <input
                        type="radio" name={`feature-${key}`} value={state} checked={states[key] === state}
                        onChange={() => setStates((prev) => ({ ...prev, [key]: state }))}
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      {label[state]}
                    </label>
                  ))}
                </fieldset>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
