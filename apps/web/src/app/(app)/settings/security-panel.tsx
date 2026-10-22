'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useState, useTransition } from 'react';
import {
  changePassword, finishTwoFactor, newRecoveryCodes, securityExtras, startTelegramBind, startTwoFactor, stopTelegramLogin,
  turnOffTwoFactor, type PasswordState, type SecurityExtras,
} from '@/app/actions/security';
import type { QrPath } from '@tasnivo/domain/security/qr';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Section } from '@/ui/page';
import { TelegramLogin } from '@/ui/telegram-login';
import { SessionList, type SessionItem } from './session-list';

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

function TwoFactor({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: QrPath } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  const finish = (): void => start(async () => {
    const result = await finishTwoFactor(code);
    setFailed(result === null);
    if (result) { setCodes(result); setSetup(null); setCode(''); router.refresh(); }
  });
  const off = (): void => start(async () => {
    const ok = await turnOffTwoFactor(code);
    setFailed(!ok);
    if (ok) { setCode(''); setCodes(null); router.refresh(); }
  });
  const regenerate = (): void => start(async () => {
    const result = await newRecoveryCodes(code);
    setFailed(result === null);
    if (result) { setCodes(result); setCode(''); router.refresh(); }
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{enabled ? ta.security.twoFactorOn(recoveryLeft) : ta.security.twoFactorOff}</p>
      {!enabled && !setup ? <Button variant="secondary" disabled={busy} onClick={() => start(async () => setSetup(await startTwoFactor()))}>{ta.security.enable}</Button> : null}
      {setup ? (
        <div className="max-w-xl space-y-2">
          <p className="text-sm">{ta.security.setupHint}</p>
          <p className="text-sm text-muted">{ta.secX.qrHint}</p>
          <QrCode qr={setup.qr} label={ta.secX.qrAlt} />
          <p className="text-sm">{ta.security.secret}: <code className="break-all font-mono">{setup.secret}</code></p>
          <p className="text-sm"><a href={setup.uri} className="text-brand hover:underline">{ta.security.uri}</a></p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder={ta.security.codeLabel} aria-label={ta.security.codeLabel} />
            <Button variant="primary" disabled={busy || code.trim().length < 6} onClick={finish}>{ta.security.confirm}</Button>
          </div>
        </div>
      ) : null}
      {enabled ? (
        <div className="max-w-xl space-y-2">
          <p className="text-xs text-muted">{ta.security.disableHint}</p>
          <div className="flex flex-wrap gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={32} placeholder={ta.security.codeLabel} aria-label={ta.security.codeLabel} className="max-w-48" />
            <Button variant="secondary" disabled={busy || code.trim().length < 6} onClick={regenerate}>{ta.security.regenerate}</Button>
            <Button variant="ghost" disabled={busy || code.trim().length < 6} onClick={off}>{ta.security.disable}</Button>
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
  const router = useRouter();
  const [state, action, pending] = useActionState<PasswordState, FormData>(async (prev, form) => {
    const next = await changePassword(prev, form);
    if (next.done) router.refresh();
    return next;
  }, {});
  return (
    <form action={action} className="max-w-md space-y-3">
      <Field label={ta.secX.password.current}>
        <Input name="current" type="password" required autoComplete="current-password" maxLength={200} />
      </Field>
      <Field label={ta.secX.password.next} hint={ta.secX.password.rule(min)}>
        <Input name="next" type="password" required minLength={min} maxLength={200} autoComplete="new-password" />
      </Field>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state.done ? <p role="status" className="text-sm text-good">{state.done}</p> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? t.loading : ta.secX.password.submit}</Button>
    </form>
  );
}

function TelegramSignIn({ info, result, onChange }: { info: SecurityExtras['telegram']; result: string | null; onChange: (result: string) => void }) {
  const { ta } = useI18n();
  const s = ta.secX.telegram;
  const [bindState, setBindState] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!info.bot) return null;
  const connect = (): void => start(async () => {
    const state = await startTelegramBind();
    if (state) setBindState(state);
    else onChange('error');
  });
  const disconnect = (): void => start(async () => onChange((await stopTelegramLogin()) ? 'unbound' : 'error'));
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-sm text-muted">{info.bound ? s.bound : s.unbound}</p>
      <p className="text-xs text-muted">{s.separate}</p>
      {result ? <p role="status" className={`text-sm ${result === 'bound' || result === 'unbound' ? 'text-good' : 'text-danger'}`}>{s.result[result] ?? s.result['error']}</p> : null}
      {info.bound && info.canUnbind ? <Button variant="ghost" disabled={busy} onClick={disconnect}>{s.disconnect}</Button> : null}
      {!info.bound && !bindState ? <Button variant="secondary" disabled={busy} onClick={connect}>{s.connect}</Button> : null}
      {!info.bound && bindState ? (
        <div className="space-y-2">
          <p className="text-sm">{s.connectHint}</p>
          <TelegramLogin bot={info.bot} authUrl={`/api/auth/telegram/bind/${bindState}`} />
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

type Props = {
  enabled: boolean; recoveryLeft: number; sessions: SessionItem[];
  /** Password and Telegram state; loaded by the panel itself when the page does not pass it. */
  extras?: SecurityExtras | null;
};

export function SecurityPanel({ enabled, recoveryLeft, sessions, extras: given = null }: Props) {
  const { ta } = useI18n();
  const [extras, setExtras] = useState<SecurityExtras | null>(given);
  const [tgResult, setTgResult] = useBindResult();
  const reload = useCallback((): void => { void securityExtras().then(setExtras); }, []);
  useEffect(() => {
    if (!given) reload();
  }, [given, reload]);
  const onTelegramChange = (result: string): void => { setTgResult(result); reload(); };
  return (
    <>
      <Section title={ta.security.twoFactor}><TwoFactor enabled={enabled} recoveryLeft={recoveryLeft} /></Section>
      {extras?.passwordChangeable ? (
        <Section title={ta.secX.password.title} hint={ta.secX.password.hint}><PasswordChange min={extras.passwordMin} /></Section>
      ) : null}
      {/* Without a configured bot there is no Telegram sign-in to offer, so the block is not shown. */}
      {extras?.telegram.available ? (
        <div id="telegram-sign-in" className="mt-8 scroll-mt-6">
          <Section title={ta.secX.telegram.title}><TelegramSignIn info={extras.telegram} result={tgResult} onChange={onTelegramChange} /></Section>
        </div>
      ) : null}
      <Section title={ta.security.sessions} hint={ta.security.sessionsHint}><SessionList sessions={sessions} /></Section>
    </>
  );
}
