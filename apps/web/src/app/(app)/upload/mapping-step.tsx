'use client';

import { useEffect, useRef, useState } from 'react';
import { diagnoseUpload } from '@/app/actions/catalog';
import { COLUMN_FIELDS, mappingIssues, type ColumnField, type ColumnMap } from '@/lib/column-map';
import type { ImportDiagnostics } from '@/lib/import-diagnostics';
import { applyPreset, IMPORT_PRESETS } from '@/lib/import-presets';
import { useI18n } from '@/lib/locale-client';
import type { UploadPreview } from '@/lib/upload-preview';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { PreviewTable } from '@/ui/preview-table';
import { Select } from '@/ui/select';
import { DiagnosticsPanel } from './diagnostics-panel';
import { Notice } from './notice';

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

/** Step 3: one select per field, the server's import diagnostics for the current choice. */
export function MappingStep({ preview, mapping, onMapping, suggested, diagnostics, onDiagnostics, onBack, onNext }: Props) {
  const { t, ta } = useI18n();
  const m = ta.importX.map;
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
      if (issue.kind === 'duplicate' && issue.fields.includes(field)) return m.duplicate(issue.fields.map((f) => labels[f]).join(', '));
    }
    return undefined;
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
      void diagnoseUpload({ catalogId: preview.catalogId, mapping })
        .then((result) => {
          if (id !== request.current) return;
          if (result.ok) onDiagnostics(result.diagnostics);
          else { onDiagnostics(null); setError(result.error); }
        })
        .catch(() => { if (id === request.current) { onDiagnostics(null); setError(ta.importX.errors.network); } })
        .finally(() => { if (id === request.current) setUpdating(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mapping, preview.catalogId, preview.headers.length]);

  const source = (field: ColumnField): string => (suggested ? m.fieldSource[preview.fields[field]] : '');
  const blocked = issues.length > 0 || updating || !diagnostics || diagnostics.importable === 0;

  return (
    <section aria-labelledby="map-title" className="space-y-5">
      <div>
        <h2 id="map-title" className="text-section">{m.title}</h2>
        <p className="mt-0.5 text-small text-muted">{m.hint}</p>
      </div>
      {suggested ? <Notice tone="info">{preview.remembered ? m.remembered[preview.remembered] : m.guessed}</Notice> : null}

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COLUMN_FIELDS.map((field) => {
          const required = field === 'name';
          const from = source(field);
          return (
            <div key={field} className="min-w-0">
              <Select
                label={labels[field]} required={required} value={mapping[field]} error={issueOf(field)}
                onChange={(e) => onMapping({ ...mapping, [field]: Number(e.target.value) }, true)}
              >
                {!required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
                {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </Select>
              {from ? <Badge className="mt-1" tone={preview.fields[field] === 'remembered' ? 'brand' : 'neutral'}>{from}</Badge> : null}
            </div>
          );
        })}
      </div>

      <DiagnosticsPanel diagnostics={issues.length > 0 ? null : diagnostics} parse={preview.parse} updating={updating} error={error} />

      <div>
        <h3 className="mb-2 text-data font-semibold">{m.sample}</h3>
        <PreviewTable
          headers={preview.headers} rows={preview.sample} limit={preview.sample.length} label={m.sample}
          roles={COLUMN_FIELDS.map((f) => [mapping[f], labels[f]] as [number, string])}
        />
      </div>

      {issues.length > 0 ? <Notice tone="danger">{m.fixFirst}</Notice> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>{m.back}</Button>
        <Button variant="primary" disabled={blocked} onClick={onNext}>{m.next}</Button>
      </div>
    </section>
  );
}
