'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CopyField } from '@/ui/copy-field';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';
import { Spinner } from '@/ui/spinner';
import { Stepper } from '@/ui/stepper';
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';

type TwoFactorState = OutputOf<typeof endpoints.auth.twoFactorState>;
type Setup = NonNullable<OutputOf<typeof endpoints.auth.twoFactorStart>>;
type QrPath = Setup['qr'];

/** Always dark on white, whatever the theme: scanners need the contrast. */
export function QrCode({ qr, label, className = 'size-44' }: { qr: QrPath; label: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges" className={`${className} shrink-0 rounded-md border border-line`}>
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

/** The one-time recovery codes, with a copy of all of them at once. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const { ta } = useI18n();
  const w = ta.mgX.settings.twoFactor;
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{ta.security.recoveryTitle}</p>
        <p className="text-small text-muted">{ta.security.recoveryHint}</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-line bg-sunken p-3 font-mono text-mono">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <Button size="sm" variant="secondary" onClick={() => { void copy(); }}>{copied ? w.codesCopied : w.copyCodes}</Button>
      <span role="status" className="sr-only">{copied ? w.codesCopied : ''}</span>
    </div>
  );
}

/** The code from the authenticator, as one labelled field. */
function CodeField({ value, onChange, error, inputRef }: { value: string; onChange: (v: string) => void; error?: string; inputRef?: Ref<HTMLInputElement> }) {
  const { ta } = useI18n();
  return (
    <Field label={ta.security.codeLabel} hint={ta.mgX.settings.twoFactor.codeHint} error={error}>
      <Input
        ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)}
        inputMode="numeric" autoComplete="one-time-code" maxLength={32} className="max-w-56 font-mono tracking-widest"
      />
    </Field>
  );
}

/** Turning two-factor on: scan the code, confirm one code from the app, keep the recovery codes. */
function SetupWizard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { ta } = useI18n();
  const w = ta.mgX.settings.twoFactor;
  const toast = useToast();
  const codeInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const begin = useMutation({ mutationFn: () => api.auth.twoFactorStart() });
  const finish = useMutation({
    mutationFn: (value: string) => api.auth.twoFactorFinish({ code: value }),
    onSuccess: async (result) => {
      if (result === null) { setWrong(true); return; }
      setWrong(false);
      toast(w.enabled);
      await onDone();
      setCodes(result);
      setStep(2);
    },
    onError: () => setWrong(true),
  });
  const setup: Setup | null | undefined = begin.data;

  // A fresh secret every time the wizard opens; nothing is saved until a code from it is confirmed.
  const { mutate: start, reset } = begin;
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCode('');
    setWrong(false);
    setCodes([]);
    start();
    return () => reset();
  }, [open, start, reset]);

  const submit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (code.trim().length < 6 || finish.isPending) return;
    finish.mutate(code.trim());
  };

  const footer = step === 0 ? (
    <>
      <Button variant="secondary" onClick={onClose}>{ta.shellX.ui.cancel}</Button>
      <Button variant="primary" disabled={!setup} onClick={() => setStep(1)}>{w.next}</Button>
    </>
  ) : step === 1 ? (
    <>
      <Button variant="secondary" disabled={finish.isPending} onClick={() => setStep(0)}>{w.back}</Button>
      <Button type="submit" form="two-factor-verify" variant="primary" loading={finish.isPending} disabled={code.trim().length < 6}>{ta.security.confirm}</Button>
    </>
  ) : (
    <Button variant="primary" onClick={onClose}>{w.done}</Button>
  );

  return (
    <Dialog
      open={open} onClose={onClose} title={w.setupTitle} size="md" footer={footer}
      // The recovery codes are shown once: leaving goes through "Done", not a stray click on the backdrop.
      dismissible={step !== 2 && !finish.isPending}
      initialFocus={step === 1 ? codeInput : undefined}
    >
      <div className="space-y-5">
        <Stepper stages={[w.steps.scan, w.steps.verify, w.steps.save]} current={step} />
        {step === 0 ? (
          !setup ? (
            begin.isError || (begin.isSuccess && !setup)
              ? <p role="alert" className="text-small font-medium text-danger-ink">{ta.security.failed}</p>
              : <div className="flex justify-center py-10"><Spinner label={ta.shellX.ui.loading} /></div>
          ) : (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <QrCode qr={setup.qr} label={ta.secX.qrAlt} />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-small">{ta.security.setupHint}</p>
                <p className="text-small text-muted">{ta.secX.qrHint}</p>
                <CopyField label={ta.security.secret} value={setup.secret} mono size="compact" />
                <a href={setup.uri} className="inline-block text-small font-medium text-brand-ink hover:underline">{ta.security.uri}</a>
              </div>
            </div>
          )
        ) : null}
        {step === 1 ? (
          <form id="two-factor-verify" onSubmit={submit} noValidate>
            <CodeField value={code} onChange={(v) => { setCode(v); setWrong(false); }} error={wrong ? ta.security.codeWrong : undefined} inputRef={codeInput} />
          </form>
        ) : null}
        {step === 2 ? <RecoveryCodes codes={codes} /> : null}
      </div>
    </Dialog>
  );
}

type Job = 'off' | 'regenerate';

/** Turning two-factor off or making new recovery codes: both need a current code. */
function CodeDialog({ job, onClose, onDone }: { job: Job | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { ta } = useI18n();
  const w = ta.mgX.settings.twoFactor;
  const toast = useToast();
  const codeInput = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const run = useMutation({
    mutationFn: async (value: string): Promise<string[] | boolean | null> => (job === 'off' ? api.auth.twoFactorOff({ code: value }) : api.auth.recoveryCodes({ code: value })),
    onSuccess: async (result) => {
      if (result === null || result === false) { setWrong(true); return; }
      setCode('');
      await onDone();
      if (job === 'regenerate' && Array.isArray(result)) {
        toast(w.regenerated);
        setCodes(result);
        return;
      }
      toast(w.disabled);
      close();
    },
    onError: () => setWrong(true),
  });
  const close = (): void => { setCode(''); setWrong(false); setCodes(null); onClose(); };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (code.trim().length < 6 || run.isPending) return;
    run.mutate(code.trim());
  };
  const title = job === 'off' ? ta.security.disable : ta.security.regenerate;

  return (
    <Dialog
      open={job !== null} onClose={close} title={title} size="sm" role={job === 'off' ? 'alertdialog' : 'dialog'}
      description={codes ? undefined : ta.security.disableHint}
      dismissible={!run.isPending && !codes} initialFocus={codeInput}
      footer={codes ? <Button variant="primary" onClick={close}>{w.done}</Button> : (
        <>
          <Button variant="secondary" disabled={run.isPending} onClick={close}>{ta.shellX.ui.cancel}</Button>
          <Button type="submit" form="two-factor-code" variant={job === 'off' ? 'danger' : 'primary'} loading={run.isPending} disabled={code.trim().length < 6}>{title}</Button>
        </>
      )}
    >
      {codes ? <RecoveryCodes codes={codes} /> : (
        <form id="two-factor-code" onSubmit={submit} noValidate>
          <CodeField value={code} onChange={(v) => { setCode(v); setWrong(false); }} error={wrong ? ta.security.codeWrong : undefined} inputRef={codeInput} />
        </form>
      )}
    </Dialog>
  );
}

/** Two-factor as a card: its state, and the wizard or code dialogs that change it. */
export function TwoFactorCard({ initial }: { initial: TwoFactorState }) {
  const { ta } = useI18n();
  const w = ta.mgX.settings.twoFactor;
  const queryClient = useQueryClient();
  const { data: { enabled, recoveryLeft } } = useSeededQuery(api.auth.twoFactorState, initial);
  const [wizard, setWizard] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKey(api.auth.twoFactorState) });
  const tone = enabled ? 'good' : 'warn';

  return (
    <Card
      id="two-factor" title={ta.security.twoFactor}
      actions={<StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{enabled ? w.on : w.off}</StatusChip>}
      footer={enabled ? (
        <>
          <Button size="sm" variant="danger-ghost" onClick={() => setJob('off')}>{ta.security.disable}</Button>
          <Button size="sm" variant="secondary" onClick={() => setJob('regenerate')}>{ta.security.regenerate}</Button>
        </>
      ) : <Button size="sm" variant="primary" onClick={() => setWizard(true)}>{ta.security.enable}</Button>}
    >
      <p className="max-w-2xl text-small text-muted">{enabled ? ta.security.twoFactorOn(recoveryLeft) : ta.security.twoFactorOff}</p>
      <SetupWizard open={wizard} onClose={() => setWizard(false)} onDone={refresh} />
      <CodeDialog job={job} onClose={() => setJob(null)} onDone={refresh} />
    </Card>
  );
}
