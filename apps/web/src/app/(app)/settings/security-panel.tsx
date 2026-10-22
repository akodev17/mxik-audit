'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { formFields } from '@/lib/api/follow';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Section } from '@/ui/page';
import { TelegramLogin } from '@/ui/telegram-login';
import { SessionList } from './session-list';

type TwoFactorState = OutputOf<typeof endpoints.auth.twoFactorState>;
type SecurityExtras = NonNullable<OutputOf<typeof endpoints.auth.security>>;
type Setup = NonNullable<OutputOf<typeof endpoints.auth.twoFactorStart>>;
type QrPath = Setup['qr'];
type PasswordState = OutputOf<typeof endpoints.auth.changePassword>;

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { ta } = useI18n();
  return (
    <div className="max-w-xl rounded-ctl border border-line-strong bg-surface p-3">
      <p className="text-sm font-bold">{ta.security.recoveryTitle}</p>
      <p className="mb-2 text-xs text-muted">{ta.security.recoveryHint}</p>
      <ul className="grid gap-1 font-mono text-sm sm:grid-cols-2">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

/** Always dark on white, whatever the theme: scanners need the contrast. */
function QrCode({ qr, label }: { qr: QrPath; label: string }) {
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="size-44 rounded-ctl border border-line">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

type CodeJob = 'finish' | 'off' | 'regenerate';

function TwoFactor({ initial }: { initial: TwoFactorState }) {
  const { ta } = useI18n();
  const queryClient = useQueryClient();
  const { data: { enabled, recoveryLeft } } = useSeededQuery(api.auth.twoFactorState, initial);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKey(api.auth.twoFactorState) });

  const begin = useMutation({ mutationFn: () => api.auth.twoFactorStart(), onSuccess: setSetup });
  const withCode = useMutation({
    mutationFn: async (job: CodeJob): Promise<string[] | boolean | null> => {
      if (job === 'finish') return api.auth.twoFactorFinish({ code });
      if (job === 'off') return api.auth.twoFactorOff({ code });
      return api.auth.recoveryCodes({ code });
    },
    onSuccess: async (result, job) => {
      const ok = result !== null && result !== false;
      setFailed(!ok);
      if (!ok) return;
      setCode('');
      if (job === 'finish') setSetup(null);
      setCodes(Array.isArray(result) ? result : null);
      await refresh();
    },
    onError: () => setFailed(true),
  });
  const busy = begin.isPending || withCode.isPending;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{enabled ? ta.security.twoFactorOn(recoveryLeft) : ta.security.twoFactorOff}</p>
      {!enabled && !setup ? <Button variant="secondary" disabled={busy} onClick={() => begin.mutate()}>{ta.security.enable}</Button> : null}
      {setup ? (
        <div className="max-w-xl space-y-2">
          <p className="text-sm">{ta.security.setupHint}</p>
          <p className="text-sm text-muted">{ta.secX.qrHint}</p>
          <QrCode qr={setup.qr} label={ta.secX.qrAlt} />
          <p className="text-sm">{ta.security.secret}: <code className="break-all font-mono">{setup.secret}</code></p>
          <p className="text-sm"><a href={setup.uri} className="text-brand hover:underline">{ta.security.uri}</a></p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder={ta.security.codeLabel} aria-label={ta.security.codeLabel} />
            <Button variant="primary" disabled={busy || code.trim().length < 6} onClick={() => withCode.mutate('finish')}>{ta.security.confirm}</Button>
          </div>
        </div>
      ) : null}
      {enabled ? (
        <div className="max-w-xl space-y-2">
          <p className="text-xs text-muted">{ta.security.disableHint}</p>
          <div className="flex flex-wrap gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={32} placeholder={ta.security.codeLabel} aria-label={ta.security.codeLabel} className="max-w-48" />
            <Button variant="secondary" disabled={busy || code.trim().length < 6} onClick={() => withCode.mutate('regenerate')}>{ta.security.regenerate}</Button>
            <Button variant="ghost" disabled={busy || code.trim().length < 6} onClick={() => withCode.mutate('off')}>{ta.security.disable}</Button>
          </div>
        </div>
      ) : null}
      {failed ? <p role="alert" className="text-sm text-danger">{ta.security.codeWrong}</p> : null}
      {codes ? <RecoveryCodes codes={codes} /> : null}
    </div>
  );
}

function PasswordChange({ min }: { min: number }) {
  const { t, ta } = useI18n();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PasswordState>({});
  const change = useMutation({
    mutationFn: (body: { current: string; next: string }) => api.auth.changePassword(body),
    onSuccess: async (answer) => {
      // Every other session ended: the list below shows only this one now.
      if (answer.done) await queryClient.invalidateQueries({ queryKey: queryKey(api.auth.sessions) });
      setState(answer);
    },
    onError: () => setState({ error: ta.security.failed }),
  });
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (change.isPending) return;
    const form = e.currentTarget;
    const fields = formFields(form);
    change.mutate({ current: fields['current'] ?? '', next: fields['next'] ?? '' }, { onSettled: () => form.reset() });
  };
  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <Field label={ta.secX.password.current}>
        <Input name="current" type="password" required autoComplete="current-password" maxLength={200} />
      </Field>
      <Field label={ta.secX.password.next} hint={ta.secX.password.rule(min)}>
        <Input name="next" type="password" required minLength={min} maxLength={200} autoComplete="new-password" />
      </Field>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state.done ? <p role="status" className="text-sm text-good">{state.done}</p> : null}
      <Button type="submit" variant="secondary" disabled={change.isPending}>{change.isPending ? t.loading : ta.secX.password.submit}</Button>
    </form>
  );
}

function TelegramSignIn({ info, result, onChange }: { info: SecurityExtras['telegram']; result: string | null; onChange: (result: string) => void }) {
  const { ta } = useI18n();
  const s = ta.secX.telegram;
  const [bindState, setBindState] = useState<string | null>(null);
  // Runs in the browser: the one-time state is kept in this browser's session cookie for the widget's callback.
  const connect = useMutation({
    mutationFn: () => api.auth.telegramBindStart().catch(() => null),
    onSuccess: (state) => { if (state) setBindState(state); else onChange('error'); },
  });
  const disconnect = useMutation({
    mutationFn: () => api.auth.telegramUnbind().catch(() => false),
    onSuccess: (ok) => onChange(ok ? 'unbound' : 'error'),
  });
  const busy = connect.isPending || disconnect.isPending;
  if (!info.bot) return null;
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-sm text-muted">{info.bound ? s.bound : s.unbound}</p>
      <p className="text-xs text-muted">{s.separate}</p>
      {result ? <p role="status" className={`text-sm ${result === 'bound' || result === 'unbound' ? 'text-good' : 'text-danger'}`}>{s.result[result] ?? s.result['error']}</p> : null}
      {info.bound && info.canUnbind ? <Button variant="ghost" disabled={busy} onClick={() => disconnect.mutate()}>{s.disconnect}</Button> : null}
      {!info.bound && !bindState ? <Button variant="secondary" disabled={busy} onClick={() => connect.mutate()}>{s.connect}</Button> : null}
      {!info.bound && bindState ? (
        <div className="space-y-2">
          <p className="text-sm">{s.connectHint}</p>
          <TelegramLogin bot={info.bot} authUrl={api.auth.telegramBind.url({ state: bindState })} />
        </div>
      ) : null}
    </div>
  );
}

/** The ?tg= result the Telegram bind callback came back with; removed from the address once read. */
function useBindResult(): [string | null, (result: string) => void] {
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const tg = url.searchParams.get('tg');
    if (!tg) return;
    setResult(tg);
    url.searchParams.delete('tg');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return [result, setResult];
}

type Initial = {
  twoFactor: TwoFactorState;
  sessions: OutputOf<typeof endpoints.auth.sessions>;
  /** Password and Telegram state; null for a demo (the API refuses it there). */
  extras: OutputOf<typeof endpoints.auth.security>;
};

export function SecurityPanel({ initial }: { initial: Initial }) {
  const { ta } = useI18n();
  const queryClient = useQueryClient();
  const { data: extras } = useSeededQuery(api.auth.security, initial.extras);
  const [tgResult, setTgResult] = useBindResult();
  const onTelegramChange = (result: string): void => {
    setTgResult(result);
    void queryClient.invalidateQueries({ queryKey: queryKey(api.auth.security) });
  };
  return (
    <>
      <Section title={ta.security.twoFactor}><TwoFactor initial={initial.twoFactor} /></Section>
      {extras?.passwordChangeable ? (
        <Section title={ta.secX.password.title} hint={ta.secX.password.hint}><PasswordChange min={extras.passwordMin} /></Section>
      ) : null}
      {/* Without a configured bot there is no Telegram sign-in to offer, so the block is not shown. */}
      {extras?.telegram.available ? (
        <div id="telegram-sign-in" className="mt-8 scroll-mt-6">
          <Section title={ta.secX.telegram.title}><TelegramSignIn info={extras.telegram} result={tgResult} onChange={onTelegramChange} /></Section>
        </div>
      ) : null}
      <Section title={ta.security.sessions} hint={ta.security.sessionsHint}><SessionList initial={initial.sessions} /></Section>
    </>
  );
}
