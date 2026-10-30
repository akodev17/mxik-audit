'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import type { BankColumnMap, BankConventions } from '@tasnivo/contracts/modules/bank';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Progress } from '@/ui/progress';
import { Select } from '@/ui/select';
import { Stepper } from '@/ui/stepper';
import { Card } from '../../_manage/card';
import { FileDrop } from '../../_manage/file-drop';
import { Notice } from '../../_manage/notice';
import { STATEMENT_ACCEPT } from '../bank-pure';
import { CheckStep } from './check-step';
import { MappingStep } from './mapping-step';

export type Preview = Extract<ResponseOf<typeof endpoints.bank.preview>, { ok: true }>['preview'];
type Step = 'file' | 'columns' | 'check' | 'read';
const STEPS: readonly Step[] = ['file', 'columns', 'check', 'read'];

/** How often the reading step asks for the statement's progress. */
const POLL_MS = 800;

/**
 * Drop a statement → its layout is recognised (or the columns are chosen once and remembered) →
 * the check shows the header, the first lines and every row that will be left out with the
 * reason → "Read statement" stores it and the lines are processed, with progress, then the review.
 */
export function BankUpload({ clients, defaultClient, ownBooks }: { clients: { id: string; name: string }[]; defaultClient: string | null; ownBooks: boolean }) {
  const { ta } = useI18n();
  const b = ta.bankX;
  const u = b.upload;
  const router = useRouter();
  const [clientId, setClientId] = useState<string>(defaultClient ?? (ownBooks ? '' : clients[0]?.id ?? ''));
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = (): void => {
    setStep('file'); setFile(null); setPreview(null); setError(null); setBatchId(null); setProgress(null);
  };

  async function choose(chosen: File): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await orRefused(api.bank.preview({ file: chosen, ...(clientId ? { clientId } : {}) }), b.errors.network);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setFile(chosen);
    setPreview(result.preview);
    setStep(result.preview.recognised ? 'check' : 'columns');
  }

  async function remap(columnMap: BankColumnMap, conventions: BankConventions): Promise<void> {
    if (!file) return;
    setError(null);
    setBusy(true);
    const result = await orRefused(api.bank.preview({ file, columnMap: JSON.stringify(columnMap), conventions: JSON.stringify(conventions), ...(clientId ? { clientId } : {}) }), b.errors.network);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setPreview(result.preview);
    setStep('check');
  }

  async function read(formatName: string | null): Promise<void> {
    if (!file || !preview) return;
    setError(null);
    setBusy(true);
    const result = await orRefused(api.bank.create({
      file, columnMap: JSON.stringify(preview.columnMap), conventions: JSON.stringify(preview.conventions),
      ...(clientId ? { clientId } : {}), ...(formatName ? { formatName } : {}),
    }), b.errors.network);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setBatchId(result.batchId);
    setProgress({ done: 0, total: preview.dataRows });
    setStep('read');
  }

  // Reading: poll the statement until its lines are processed, then open the review.
  useEffect(() => {
    if (step !== 'read' || !batchId) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      const answer = await orRefused(api.bank.statement({ batchId }).then((r) => ({ ok: true as const, ...r })), b.errors.network);
      if (stopped) return;
      if (!answer.ok) { setError(answer.error); return; }
      const s = answer.statement;
      if (s.status === 'failed') { setError(s.error ?? u.failed); return; }
      if (s.status !== 'uploaded') { router.push(`/bank/${batchId}`); return; }
      if (s.progress) setProgress(s.progress);
      setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { stopped = true; };
  }, [step, batchId, router, b.errors.network, u.failed]);

  return (
    <div className="space-y-4">
      <Stepper stages={STEPS.map((s) => u.steps[s])} current={STEPS.indexOf(step)} />
      {step === 'file' ? (
        <Card title={u.title} hint={u.hint} as="h2">
          <div className="space-y-3">
            {clients.length > 0 ? (
              <Select label={u.client} value={clientId} onChange={(e) => setClientId(e.target.value)} wrapperClassName="sm:w-80">
                {ownBooks ? <option value="">{u.clientNone}</option> : null}
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            ) : null}
            <FileDrop onFile={(f) => void choose(f)} busy={busy} accept={STATEMENT_ACCEPT} />
          </div>
        </Card>
      ) : null}
      {step === 'columns' && preview ? (
        <MappingStep preview={preview} busy={busy} onBack={reset} onDone={(m, c) => void remap(m, c)} />
      ) : null}
      {step === 'check' && preview ? (
        <CheckStep preview={preview} busy={busy} onBack={reset} onColumns={() => setStep('columns')} onRead={(name) => void read(name)} />
      ) : null}
      {step === 'read' ? (
        <Card title={u.processing} as="h2">
          <Progress label={u.processing} value={progress?.done ?? 0} max={Math.max(1, progress?.total ?? 1)} valueText={progress ? u.progress(progress.done, progress.total) : undefined} />
        </Card>
      ) : null}
      {error ? <Notice tone="danger" action={step !== 'file' ? <button type="button" className="underline" onClick={reset}>{u.again}</button> : undefined}>{error}</Notice> : null}
    </div>
  );
}
