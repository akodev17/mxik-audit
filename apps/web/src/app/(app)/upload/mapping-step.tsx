'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { failureText } from '@/lib/catalogs/client';
import type { ColumnField, ColumnMap, ImportDiagnostics, UploadPreview } from '@/lib/catalogs/types';
import { applyPreset, COLUMN_FIELDS, IMPORT_PRESETS, mappingIssues } from '@/lib/catalogs/upload';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconAlert, IconChevron } from '@/ui/icons';
import { PreviewTable } from '@/ui/preview-table';
import { Select } from '@/ui/select';
import { DiagnosticsPanel } from './diagnostics-panel';
import { Notice } from './notice';
import { StepCard, StepFooter } from './step-card';

type Props = {
  preview: UploadPreview;
  mapping: ColumnMap;
  onMapping: (mapping: ColumnMap, fromUser: boolean) => void;
  /** True while the shown mapping is the one the server suggested. */
  suggested: boolean;
  diagnostics: ImportDiagnostics | null;
  onDiagnostics: (d: ImportDiagnostics | null) => void;
  onBack: () => void;
  onNext: () => void;
};

const DEBOUNCE_MS = 350;

type RowProps = {
  field: ColumnField;
  label: string;
  required: boolean;
  value: number;
  headers: string[];
  /** First non-empty value of the chosen column in the sample, to check the choice at a glance. */
  example: string | null;
  source: string;
  remembered: boolean;
  error: string | undefined;
  onChange: (column: number) => void;
};

/** One "field → file column" line: the field and its origin on the left, the column picker and its example on the right. */
function MappingRow({ field, label, required, value, headers, example, source, remembered, error, onChange }: RowProps) {
  const { t, ta } = useI18n();
  const f = ta.importX.flow;
  const id = useId();
  const errorId = `${id}-error`;
  const exampleId = `${id}-example`;
  return (
    <li className="grid gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,13rem)_1rem_minmax(0,1fr)] sm:items-start">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:min-h-control-md">
        <label htmlFor={id} className="text-data font-medium text-fg">
          {label}
          {required ? <span aria-hidden className="text-danger-ink"> *</span> : null}
        </label>
        {required ? <span className="text-micro text-muted">{f.required}</span> : null}
        {source ? <Badge tone={remembered ? 'brand' : 'neutral'}>{source}</Badge> : null}
      </div>
      <IconChevron size={16} className="mt-2.5 hidden text-subtle sm:block" />
      <div className="min-w-0">
        <Select
          id={id} data-field={field} value={value} required={required} invalid={Boolean(error)}
          aria-describedby={cx(error && errorId, example && exampleId) || undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {!required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
          {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
        </Select>
        {error ? (
          <p id={errorId} className="mt-1 flex items-start gap-1 text-micro font-medium text-danger-ink">
            <IconAlert size={14} className="mt-px shrink-0" />{error}
          </p>
        ) : example ? (
          <p id={exampleId} className="mt-1 truncate text-micro text-muted" title={example}>{f.example(example)}</p>
        ) : null}
      </div>
    </li>
  );
}

/** Step 3: field → file column for each field, the server's import diagnostics for the current choice beside it. */
export function MappingStep({ preview, mapping, onMapping, suggested, diagnostics, onDiagnostics, onBack, onNext }: Props) {
  const { ta } = useI18n();
  const m = ta.importX.map;
  const f = ta.importX.flow;
  const labels = ta.importX.fields;
  const [preset, setPreset] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const first = useRef(true);

  const issues = mappingIssues(mapping, preview.headers.length);
  const issueOf = (field: ColumnField): string | undefined => {
    for (const issue of issues) {
      if (issue.kind === 'out_of_range' && issue.field === field) return m.outOfRange;
      if (issue.kind === 'duplicate' && issue.fields.includes(field)) return m.duplicate(issue.fields.map((x) => labels[x]).join(', '));
    }
    return undefined;
  };
  const exampleOf = (column: number): string | null => {
    if (column < 0) return null;
    for (const row of preview.sample) {
      const v = (row[column] ?? '').trim();
      if (v) return v;
    }
    return null;
  };

  // Recomputed on the server for every mapping change, latest request wins.
  // Only a new mapping triggers a recompute (onDiagnostics, diagnostics and ta are read, not watched);
  // the diagnostics that came with the preview are used as they are.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (diagnostics) return;
    }
    const id = ++request.current;
    if (mappingIssues(mapping, preview.headers.length).length > 0) { setUpdating(false); return; }
    setUpdating(true);
    setError(null);
    const timer = setTimeout(() => {
      void api.catalogs.diagnose({ catalogId: preview.catalogId, mapping })
        .then((result) => {
          if (id !== request.current) return;
          if (result.ok) onDiagnostics(result.diagnostics);
          else { onDiagnostics(null); setError(result.error); }
        })
        .catch((e: unknown) => { if (id === request.current) { onDiagnostics(null); setError(failureText(e, ta.importX.errors.network)); } })
        .finally(() => { if (id === request.current) setUpdating(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mapping, preview.catalogId, preview.headers.length]);

  const source = (field: ColumnField): string => (suggested ? m.fieldSource[preview.fields[field]] : '');
  const blocked = issues.length > 0 || updating || !diagnostics || diagnostics.importable === 0;

  return (
    <StepCard titleId="map-title" title={m.title} hint={m.hint}>
      {suggested ? <Notice tone="info">{preview.remembered ? m.remembered[preview.remembered] : m.guessed}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0">
          <Select
            label={m.preset} hint={m.presetHint} value={preset} wrapperClassName="max-w-md"
            onChange={(e) => {
              setPreset(e.target.value);
              const chosen = IMPORT_PRESETS.find((p) => p.id === e.target.value);
              onMapping(chosen ? applyPreset(chosen, preview.headers, preview.mapping) : preview.mapping, Boolean(chosen));
            }}
          >
            <option value="">{m.presetSuggested}</option>
            {IMPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{m.presets[p.id]}</option>)}
          </Select>

          <div aria-hidden className="mt-5 hidden grid-cols-[minmax(0,13rem)_1rem_minmax(0,1fr)] gap-x-3 border-b border-line-strong pb-2 text-small font-medium text-muted sm:grid">
            <span>{f.fieldCol}</span><span /><span>{f.fileCol}</span>
          </div>
          <ul className="divide-y divide-line border-b border-line max-sm:mt-3 max-sm:border-t">
            {COLUMN_FIELDS.map((field) => (
              <MappingRow
                key={field} field={field} label={labels[field]} required={field === 'name'} value={mapping[field]}
                headers={preview.headers} example={exampleOf(mapping[field])}
                source={source(field)} remembered={preview.fields[field] === 'remembered'} error={issueOf(field)}
                onChange={(column) => onMapping({ ...mapping, [field]: column }, true)}
              />
            ))}
          </ul>
        </div>

        <div className="min-w-0 lg:border-l lg:border-line lg:pl-6">
          <div className="lg:sticky lg:top-4">
            <DiagnosticsPanel diagnostics={issues.length > 0 ? null : diagnostics} parse={preview.parse} updating={updating} error={error} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-data font-semibold">{m.sample}</h3>
        <PreviewTable
          headers={preview.headers} rows={preview.sample} limit={preview.sample.length} label={m.sample}
          roles={COLUMN_FIELDS.map((field) => [mapping[field], labels[field]] as [number, string])}
          kindLabels={f.kinds} kindHint={f.kindHint}
        />
      </div>

      {issues.length > 0 ? <Notice tone="danger">{m.fixFirst}</Notice> : null}
      <StepFooter>
        <Button variant="ghost" onClick={onBack}>{m.back}</Button>
        <Button variant="primary" disabled={blocked} onClick={onNext}>{m.next}</Button>
      </StepFooter>
    </StepCard>
  );
}
