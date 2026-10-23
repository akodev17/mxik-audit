'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { formFields } from '@/lib/api/follow';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { TelegramLogin } from '@/ui/telegram-login';
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';
import { Notice } from '../_manage/notice';
import { SessionList } from './session-list';
import { TwoFactorCard } from './two-factor';

type TwoFactorState = OutputOf<typeof endpoints.auth.twoFactorState>;
type SecurityExtras = NonNullable<OutputOf<typeof endpoints.auth.security>>;
type PasswordState = OutputOf<typeof endpoints.auth.changePassword>;

const PASSWORD_FORM = 'password-form';

function PasswordCard({ min }: { min: number }) {
  const { ta } = useI18n();
  const p = ta.secX.password;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PasswordState>({});
  const change = useMutation({
    mutationFn: (body: { current: string; next: string }) => api.auth.changePassword(body),
    onSuccess: async (answer) => {
      // Every other session ended: the list below shows only this one now.
      if (answer.done) {
        toast(answer.done);
        await queryClient.invalidateQueries({ queryKey: queryKey(api.auth.sessions) });
      }
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
    <Card
      id="password" title={p.title} hint={p.hint}
      footer={<Button type="submit" form={PASSWORD_FORM} size="sm" variant="primary" loading={change.isPending}>{p.submit}</Button>}
    >
      <form id={PASSWORD_FORM} onSubmit={submit} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label={p.current}>
          <Input name="current" type="password" required autoComplete="current-password" maxLength={200} />
        </Field>
        <Field label={p.next} hint={p.rule(min)}>
          <Input name="next" type="password" required minLength={min} maxLength={200} autoComplete="new-password" />
        </Field>
        {state.error ? <p role="alert" className="text-small font-medium text-danger-ink sm:col-span-2">{state.error}</p> : null}
        {state.done ? <p role="status" className="text-small text-good-ink sm:col-span-2">{state.done}</p> : null}
      </form>
    </Card>
  );
}

function TelegramSignIn({ info, result, onChange }: { info: SecurityExtras['telegram']; result: string | null; onChange: (result: string) => void }) {
  const { ta } = useI18n();
  const s = ta.secX.telegram;
  const w = ta.mgX.settings.twoFactor;
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
  const tone = info.bound ? 'good' : 'neutral';
  const good = result === 'bound' || result === 'unbound';
  return (
    <Card
      id="telegram-sign-in" title={s.title} hint={s.separate}
      actions={<StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{info.bound ? w.on : w.off}</StatusChip>}
      footer={info.bound
        ? (info.canUnbind ? <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => disconnect.mutate()}>{s.disconnect}</Button> : null)
        : !bindState ? <Button size="sm" variant="secondary" loading={connect.isPending} disabled={busy} onClick={() => connect.mutate()}>{s.connect}</Button> : null}
    >
      <div className="space-y-3">
        <p className="text-small text-muted">{info.bound ? s.bound : s.unbound}</p>
        {result ? <Notice tone={good ? 'good' : 'danger'}>{s.result[result] ?? s.result['error']}</Notice> : null}
        {!info.bound && bindState ? (
          <div className="space-y-2">
            <p className="text-small">{s.connectHint}</p>
            <TelegramLogin bot={info.bot} authUrl={api.auth.telegramBind.url({ state: bindState })} />
          </div>
        ) : null}
      </div>
    </Card>
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
  const queryClient = useQueryClient();
  const { data: extras } = useSeededQuery(api.auth.security, initial.extras);
  const [tgResult, setTgResult] = useBindResult();
  const onTelegramChange = (result: string): void => {
    setTgResult(result);
    void queryClient.invalidateQueries({ queryKey: queryKey(api.auth.security) });
  };
  return (
    <div className="space-y-4">
      <TwoFactorCard initial={initial.twoFactor} />
      {extras?.passwordChangeable ? <PasswordCard min={extras.passwordMin} /> : null}
      {/* Without a configured bot there is no Telegram sign-in to offer, so the card is not shown. */}
      {extras?.telegram.available ? <TelegramSignIn info={extras.telegram} result={tgResult} onChange={onTelegramChange} /> : null}
      <SessionList initial={initial.sessions} />
    </div>
  );
}
