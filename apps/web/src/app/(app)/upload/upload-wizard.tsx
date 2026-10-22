'use client';

import { useCallback, useState, useTransition } from 'react';
import { commitUpload, discardUpload, previewUpload } from '@/app/actions/catalog';
import type { ColumnMap } from '@/lib/column-map';
import type { ImportDiagnostics } from '@/lib/import-diagnostics';
import { useI18n } from '@/lib/locale-client';
import { hasUploadExtension } from '@/lib/upload-file-types';
import type { UploadPreview } from '@/lib/upload-preview';
import type { CompletionSummary } from '@/lib/upload-progress';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Select } from '@/ui/select';
import { Stepper } from '@/ui/stepper';
import { ConfirmStep } from './confirm-step';
import { DoneStep } from './done-step';
import { Dropzone } from './dropzone';
import { FileCheck } from './file-check';
import { MappingStep } from './mapping-step';
import { Notice } from './notice';
import { ProcessingStep } from './processing-step';
import { followsStart, phaseOf, startKey, type WizardStart } from './wizard-start';

export type { WizardStart } from './wizard-start';

type ClientOption = { id: string; name: string };

type State =
  | { step: 'select' }
  | { step: 'check' | 'map' | 'confirm'; preview: UploadPreview }
  | { step: 'processing'; catalogId: string }
  | { step: 'done'; catalogId: string; summary: CompletionSummary };

const STEP_INDEX: Record<State['step'], number> = { select: 0, check: 1, map: 2, confirm: 3, processing: 4, done: 5 };

const catalogOf = (s: State): string | null => (s.step === 'select' ? null : 'preview' in s ? s.preview.catalogId : s.catalogId);

/** Select file → check → map columns → confirm → processing → done. */
export function UploadWizard({ clients, initialClientId, start }: { clients: ClientOption[]; initialClientId: string; start: WizardStart }) {
  const { ta } = useI18n();
  const x = ta.importX;
  const [state, setState] = useState<State>(start);
  const [clientId, setClientId] = useState(initialClientId);
  const [mapping, setMapping] = useState<ColumnMap | null>(start.step === 'map' ? start.preview.mapping : null);
  const [suggested, setSuggested] = useState(true);
  const [diagnostics, setDiagnostics] = useState<ImportDiagnostics | null>(start.step === 'map' ? start.preview.diagnostics : null);
  const [error, setError] = useState<string | null>(null);
  const [committedId, setCommittedId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [reading, startReading] = useTransition();
  const [committing, startCommit] = useTransition();

  // The page renders again for the URL this wizard writes (and on refreshes). Only another upload, a fresh
  // /upload or the same upload committed elsewhere replaces the screen; never the mapping being edited.
  const key = startKey(start, initialClientId);
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    if (followsStart(start, { catalogId: catalogOf(state), phase: phaseOf(state.step) })) {
      setState(start);
      setClientId(initialClientId);
      setMapping(start.step === 'map' ? start.preview.mapping : null);
      setSuggested(true);
      setDiagnostics(start.step === 'map' ? start.preview.diagnostics : null);
      setError(null);
      setCommittedId(null);
      setConfirmDiscard(false);
    }
  }

  const preview = state.step === 'check' || state.step === 'map' || state.step === 'confirm' ? state.preview : null;

  const readFile = (file: File): void => {
    // A dropped file skips the picker's filter; refuse other types before sending anything.
    if (!hasUploadExtension(file.name)) { setError(x.errors.fileType); return; }
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    setError(null);
    startReading(async () => {
      const result = await previewUpload(form).catch(() => ({ ok: false as const, error: x.errors.network }));
      if (!result.ok) { setError(result.error); return; }
      setMapping(result.preview.mapping);
      setSuggested(true);
      setDiagnostics(result.preview.diagnostics);
      setState({ step: 'check', preview: result.preview });
      // A refresh or a later visit comes back to this preview.
      window.history.replaceState(null, '', `/upload?catalog=${result.preview.catalogId}`);
    });
  };

  const commit = (): void => {
    if (!preview || !mapping) return;
    setError(null);
    setCommittedId(null);
    startCommit(async () => {
      const result = await commitUpload({ catalogId: preview.catalogId, mapping }).catch(() => ({ ok: false as const, error: x.errors.network, committed: false }));
      if (!result.ok) {
        setError(result.error);
        if (result.committed) setCommittedId(preview.catalogId);
        return;
      }
      setState({ step: 'processing', catalogId: result.catalogId });
    });
  };

  const startOver = (): void => {
    setState({ step: 'select' });
    setMapping(null);
    setDiagnostics(null);
    setError(null);
    window.history.replaceState(null, '', '/upload');
  };

  const onDone = useCallback((summary: CompletionSummary) => {
    setState((s) => (s.step === 'processing' ? { step: 'done', catalogId: s.catalogId, summary } : s));
  }, []);

  const onMapping = (next: ColumnMap, fromUser: boolean): void => {
    setMapping(next);
    setSuggested(!fromUser);
  };

  return (
    <div className="space-y-6">
      <Stepper stages={x.steps} current={STEP_INDEX[state.step]} />

      {state.step === 'select' ? (
        <div className="space-y-4">
          {clients.length > 1 ? (
            <Select
              label={x.select.client} hint={x.select.clientHint} value={clientId} wrapperClassName="max-w-md"
              disabled={reading} onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <p className="text-data"><span className="text-muted">{x.select.client}:</span> <span className="font-medium">{clients[0]?.name}</span></p>
          )}
          <Dropzone onFile={readFile} busy={reading} />
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      ) : null}

      {state.step === 'check' ? (
        <FileCheck preview={state.preview} onNext={() => setState({ step: 'map', preview: state.preview })} onStartOver={() => setConfirmDiscard(true)} />
      ) : null}

      {state.step === 'map' && mapping ? (
        <MappingStep
          key={state.preview.catalogId} preview={state.preview} mapping={mapping} onMapping={onMapping} suggested={suggested}
          diagnostics={diagnostics} onDiagnostics={setDiagnostics}
          onBack={() => setState({ step: 'check', preview: state.preview })}
          onNext={() => { setError(null); setState({ step: 'confirm', preview: state.preview }); }}
        />
      ) : null}

      {state.step === 'confirm' && diagnostics && mapping ? (
        <ConfirmStep
          preview={state.preview} mapping={mapping} diagnostics={diagnostics} busy={committing} error={error} committedId={committedId}
          onBack={() => setState({ step: 'map', preview: state.preview })} onStart={commit}
        />
      ) : null}

      {state.step === 'processing' ? <ProcessingStep key={state.catalogId} catalogId={state.catalogId} onDone={onDone} /> : null}

      {state.step === 'done' ? <DoneStep catalogId={state.catalogId} summary={state.summary} onAnother={startOver} /> : null}

      {preview ? (
        <ConfirmDialog
          open={confirmDiscard} onClose={() => setConfirmDiscard(false)} tone="danger"
          title={x.discard.title} description={x.discard.description} scope={`${preview.client.name} · ${preview.filename}`}
          confirmLabel={x.discard.confirm} cancelLabel={x.discard.keep}
          onConfirm={async () => {
            const result = await discardUpload(preview.catalogId).catch(() => ({ ok: false as const, error: x.errors.network }));
            if (!result.ok) return result;
            startOver();
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );
}
