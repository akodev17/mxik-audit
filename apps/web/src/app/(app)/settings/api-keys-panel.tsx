'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addApiKey, removeApiKey } from '@/app/actions/api-keys';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { Field, Input } from '@/ui/input';
import { useToast } from '@/ui/toast';

/** `creator`: the email of the member who made the key, null when not recorded or `creatorRemoved`. */
export type ApiKeyRow = {
  id: string; name: string; prefix: string; created: string; lastUsed: string | null; revoked: boolean; checks: string;
  creator: string | null; creatorRemoved: boolean;
};
type Usage = { checks: string; requests: string; cap: string | null };

function KeyRow({ apiKey }: { apiKey: ApiKeyRow }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const revoke = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const ok = await removeApiKey(apiKey.id).catch(() => false);
    if (!ok) return { ok: false, error: s.revokeFailed };
    toast(s.revokedToast(apiKey.name));
    router.refresh();
    return { ok: true };
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{apiKey.name}</span>
          <code className="font-mono text-mono text-muted">{apiKey.prefix}…</code>
          {apiKey.revoked ? <Badge>{s.revoked}</Badge> : null}
        </p>
        <p className="text-small text-muted">{s.keyMeta(apiKey.created, apiKey.lastUsed, apiKey.checks)}</p>
        {apiKey.creator ? <p className="text-small text-muted">{s.createdBy(apiKey.creator)}</p> : null}
        {apiKey.creatorRemoved ? <p className="text-small text-muted">{s.creatorRemoved}</p> : null}
      </div>
      {apiKey.revoked ? null : <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{s.revoke}</Button>}
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={s.revokeTitle(apiKey.name)} description={s.revokeText} confirmLabel={s.revokeConfirm}
        onConfirm={revoke}
      />
    </li>
  );
}

/** Admin: create a key (shown once, with a copy button), see this month's use, revoke a key by name. */
export function ApiKeysPanel({ keys, usage, max }: { keys: ApiKeyRow[]; usage: Usage; max: number }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const full = keys.filter((k) => !k.revoked).length >= max;

  const create = (): void => {
    if (name.trim() === '') { setError(s.keyNameRequired); return; }
    start(async () => {
      const result = await addApiKey(name).catch(() => ({ error: 'failed' as const }));
      if ('token' in result && result.token) {
        setToken(result.token);
        setName('');
        setError(null);
        router.refresh();
        return;
      }
      const reason = 'error' in result ? result.error : 'failed';
      setError(reason === 'limit' ? s.limitReached(max) : reason === 'name' ? s.keyNameRequired : s.createFailed);
    });
  };

  return (
    <div className="space-y-5">
      <div className="max-w-xl space-y-1 text-small">
        <p className="text-muted">{s.apiHint} <Link href="/api-docs" className="font-medium text-brand-ink underline">{s.docs}</Link></p>
        <p>{s.usage(usage.checks, usage.requests)} {usage.cap === null ? s.usageNoCap : s.usageCap(usage.cap)}</p>
      </div>

      {full ? <p className="max-w-xl text-small text-muted">{s.limitReached(max)}</p> : (
        <form className="flex max-w-xl flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); create(); }} noValidate>
          <Field label={s.keyName} hint={s.keyNameHint} error={error ?? undefined} className="min-w-0 flex-1 basis-56">
            <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={60} autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary" loading={busy} className="sm:mt-6">{s.create}</Button>
        </form>
      )}

      {token ? (
        <div role="status" className="max-w-xl space-y-2 rounded-md border border-warn bg-warn-tint p-3">
          <p className="text-small font-medium text-warn-ink">{s.once}</p>
          <CopyField label={s.newKey} value={token} mono />
          <Button size="sm" variant="ghost" onClick={() => setToken(null)}>{s.hideKey}</Button>
        </div>
      ) : null}

      {keys.length === 0 ? <p className="text-small text-muted">{s.none}</p> : (
        <ul className="max-w-2xl divide-y divide-line rounded-md border border-line">
          {keys.map((k) => <KeyRow key={k.id} apiKey={k} />)}
        </ul>
      )}
    </div>
  );
}
