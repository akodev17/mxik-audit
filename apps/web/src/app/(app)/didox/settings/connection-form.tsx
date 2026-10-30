'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Field, Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';
import { Notice } from '../../_manage/notice';

type Connection = ResponseOf<typeof endpoints.didox.connection>;

export function ConnectionForm({ connection, clients, demo }: { connection: Connection; clients: Array<{ id: string; name: string }>; demo: boolean }) {
  const { locale, ta } = useI18n();
  const s = ta.didoxX.settings;
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState<'token' | 'partner'>(connection.kind);
  const [companyTin, setTin] = useState(connection.companyTin);
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState(connection.tokenExpiresAt?.slice(0, 10) ?? '');
  const [partnerRef, setPartnerRef] = useState(connection.partnerTokenRef ?? 'DIDOX_PARTNER_TOKEN');
  const [clientId, setClientId] = useState(connection.clientId ?? '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'danger' | 'info'; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [logging, startLogin] = useTransition();

  const save = (): void => {
    setMessage(null);
    startSave(async () => {
      const res = await orRefused(api.didox.saveConnection({
        kind, companyTin, ...(token ? { token } : {}), tokenExpiresAt: expires, clientId, ...(kind === 'partner' ? { partnerTokenRef: partnerRef } : {}),
      }), ta.didoxX.errors.generic);
      if (!res.ok) { setMessage({ tone: 'danger', text: res.error }); return; }
      setToken('');
      toast(s.saved);
      router.refresh();
    });
  };

  const test = (): void => {
    setMessage(null);
    startTest(async () => {
      const res = await orRefused(api.didox.testConnection(), ta.didoxX.errors.generic);
      if (!res.ok) { setMessage({ tone: 'danger', text: res.error }); router.refresh(); return; }
      setMessage(res.authorized ? { tone: 'good', text: s.testOk } : { tone: 'info', text: s.testReachable });
      router.refresh();
    });
  };

  const login = (): void => {
    setMessage(null);
    startLogin(async () => {
      const res = await orRefused(api.didox.passwordLogin({ companyTin, password }), ta.didoxX.errors.generic);
      setPassword('');
      if (!res.ok) { setMessage({ tone: 'danger', text: res.error }); return; }
      toast(s.saved);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card
        title={s.title}
        hint={`${s.baseUrl}: ${connection.baseUrl}`}
        footer={(
          <span className="flex flex-wrap justify-end gap-2">
            {connection.connected ? <Button variant="danger-ghost" onClick={() => setRemoving(true)} disabled={demo}>{s.remove}</Button> : null}
            {connection.connected ? <Button onClick={test} loading={testing}>{s.test}</Button> : null}
            <Button variant="primary" onClick={save} loading={saving} disabled={demo || !/^(\d{9}|\d{14})$/.test(companyTin) || (!token && !connection.hasToken)}>{s.save}</Button>
          </span>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={s.kind} value={kind} onChange={(e) => setKind(e.target.value as 'token' | 'partner')} wrapperClassName="sm:col-span-2">
            <option value="token">{s.kinds.token}</option>
            <option value="partner">{s.kinds.partner}</option>
          </Select>
          <Field label={s.companyTin} required><Input value={companyTin} onChange={(e) => setTin(e.target.value.replace(/\D/g, '').slice(0, 14))} inputMode="numeric" /></Field>
          <Select label={s.client} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{ta.didoxX.upload.ownBooks}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Field label={s.token} hint={connection.hasToken ? s.tokenKeep : undefined} className="sm:col-span-2">
            <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={s.tokenExpires}><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
          {kind === 'partner' ? <Field label={s.partnerRef}><Input value={partnerRef} onChange={(e) => setPartnerRef(e.target.value.toUpperCase())} className="font-mono" /></Field> : null}
        </div>
        {connection.lastSyncAt || connection.lastError ? (
          <dl className="mt-4 grid gap-2 border-t border-line pt-3 text-small sm:grid-cols-2">
            <div><dt className="text-muted">{ta.didoxX.sync.lastSync}</dt><dd>{connection.lastSyncAt ? fmtDateTime(locale, connection.lastSyncAt) : ta.didoxX.sync.never}</dd></div>
            {connection.lastError ? <div><dt className="text-muted">{s.lastError}</dt><dd className="text-danger-ink">{ta.didoxX.errors.didox[connection.lastError] ?? connection.lastError}</dd></div> : null}
            {connection.lastErrorDetail ? <div><dt className="text-muted">{s.lastErrorDetail}</dt><dd className="break-words font-mono text-small">{connection.lastErrorDetail}</dd></div> : null}
          </dl>
        ) : null}
        {message ? <Notice tone={message.tone} className="mt-4">{message.text}</Notice> : null}
      </Card>

      {connection.passwordLogin ? (
        <Card title={s.password} hint={s.passwordHint} footer={<span className="flex justify-end"><Button onClick={login} loading={logging} disabled={demo || !password || !/^(\d{9}|\d{14})$/.test(companyTin)}>{s.login}</Button></span>}>
          <Field label={s.passwordField}><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
        </Card>
      ) : null}

      <ConfirmDialog
        open={removing} onClose={() => setRemoving(false)} tone="danger" title={s.remove} description={s.removeConfirm} confirmLabel={s.remove}
        onConfirm={async () => {
          const res = await orRefused(api.didox.removeConnection(), ta.shellX.ui.confirmFailed);
          if ('ok' in res && !res.ok) return { ok: false, error: 'error' in res ? res.error : ta.shellX.ui.confirmFailed };
          router.refresh();
          return { ok: true };
        }}
      />
    </div>
  );
}
