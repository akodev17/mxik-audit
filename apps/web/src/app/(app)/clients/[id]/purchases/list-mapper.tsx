'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { Card } from '../../../_manage/card';
import { Notice } from '../../../_manage/notice';
import { ListPreview } from '../../../_manage/preview';

export type MapperField<K extends string> = { key: K; label: string; required: boolean };
type Outcome = { ok: true } | { ok: false; error: string };

type Props<K extends string> = {
  title: string;
  headers: string[];
  rows: string[][];
  fields: MapperField<K>[];
  initial: Record<K, number>;
  submitLabel: string;
  notes?: ReactNode;
  onSubmit: (map: Record<K, number>) => Promise<Outcome>;
  onClose?: () => void;
};

/** Column mapping for a purchase, cheque or sales list: one select per field, the first rows, inline errors. */
export function ListMapper<K extends string>({ title, headers, rows, fields, initial, submitLabel, notes, onSubmit, onClose }: Props<K>) {
  const { t, ta } = useI18n();
  const [map, setMap] = useState<Record<K, number>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const used = new Map<number, K[]>();
  for (const f of fields) {
    const i = map[f.key];
    if (i >= 0) used.set(i, [...(used.get(i) ?? []), f.key]);
  }
  const issueOf = (key: K): string | undefined => {
    const i = map[key];
    if (i >= headers.length) return ta.importX.map.outOfRange;
    const shared = i >= 0 ? used.get(i) ?? [] : [];
    return shared.length > 1 ? ta.importX.map.duplicate(shared.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')) : undefined;
  };
  const invalid = fields.some((f) => issueOf(f.key) !== undefined || (f.required && map[f.key] < 0));

  const submit = (): void => {
    setError(null);
    start(async () => {
      const outcome = await onSubmit(map).catch((): Outcome => ({ ok: false, error: ta.importX.errors.network }));
      if (!outcome.ok) setError(outcome.error);
    });
  };

  return (
    <Card
      title={title} as="h3"
      footer={(
        <>
          {onClose ? <Button variant="ghost" onClick={onClose} disabled={busy}>{ta.importX.lists.close}</Button> : null}
          <Button variant="primary" loading={busy} disabled={invalid} onClick={submit}>{submitLabel}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {notes}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <Select
              key={f.key} label={f.label} required={f.required} value={map[f.key]} error={issueOf(f.key)}
              onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}
            >
              {!f.required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
              {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
            </Select>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-small font-medium text-muted">{ta.mgX.clients.upload.preview}</p>
          <ListPreview headers={headers} rows={rows} label={title} roles={fields.map((f) => [map[f.key], f.label] as [number, string])} />
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Card>
  );
}
