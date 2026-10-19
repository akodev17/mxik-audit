'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { endOtherSessions, endSession, finishTwoFactor, newRecoveryCodes, startTwoFactor, turnOffTwoFactor } from '@/app/actions/security';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

export type SessionItem = { id: string; device: string | null; created: string; seen: string; current: boolean };

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { ta } = useI18n();
  return (
    <div className="max-w-xl rounded-ctl border border-line-strong bg-surface p-3">
      <p className="text-sm font-bold">{ta.security.recoveryTitle}</p>
      <p className="mb-2 text-xs text-muted">{ta.security.recoveryHint}</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

function TwoFactor({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
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

function Sessions({ sessions }: { sessions: SessionItem[] }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  const act = (job: () => Promise<unknown>): void => start(async () => { await job(); router.refresh(); });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{ta.security.sessionsHint}</p>
      <ul className="max-w-2xl divide-y divide-line rounded-ctl border border-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{s.device ?? ta.security.unknownDevice}</span> {s.current ? <Badge tone="good">{ta.security.current}</Badge> : null}
              <span className="block text-xs text-muted">{ta.security.lastSeen(s.created, s.seen)}</span>
            </span>
            {s.current ? null : <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => endSession(s.id))}>{ta.security.endSession}</Button>}
          </li>
        ))}
      </ul>
      {sessions.some((s) => !s.current) ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => act(endOtherSessions)}>{ta.security.endOthers}</Button> : null}
    </div>
  );
}

export function SecurityPanel({ enabled, recoveryLeft, sessions }: { enabled: boolean; recoveryLeft: number; sessions: SessionItem[] }) {
  const { ta } = useI18n();
  return (
    <div className="space-y-8">
      <div><h3 className="mb-2 text-sm font-bold">{ta.security.twoFactor}</h3><TwoFactor enabled={enabled} recoveryLeft={recoveryLeft} /></div>
      <div><h3 className="mb-2 text-sm font-bold">{ta.security.sessions}</h3><Sessions sessions={sessions} /></div>
    </div>
  );
}
