'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { EmptyState } from '@/ui/empty-state';
import { Field, Input } from '@/ui/input';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../_manage/card';

type Keys = OutputOf<typeof endpoints.account.apiKeys>;

/** `creator`: the email of the member who made the key, null when not recorded or `creatorRemoved`. */
export type ApiKeyRow = {
  id: string; name: string; prefix: string; created: string; lastUsed: string | null; revoked: boolean; checks: string;
  creator: string | null; creatorRemoved: boolean;
};

function KeyRow({ apiKey }: { apiKey: ApiKeyRow }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const k = ta.mgX.settings.keys;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const revoke = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const ok = await api.account.revokeApiKey({ keyId: apiKey.id }).catch(() => false);
    if (!ok) return { ok: false, error: s.revokeFailed };
    toast(s.revokedToast(apiKey.name));
    await queryClient.invalidateQueries({ queryKey: queryKey(api.account.apiKeys) });
    return { ok: true };
  };

  const tone = apiKey.revoked ? 'neutral' : 'good';
  return (
    <tr className={apiKey.revoked ? 'text-muted' : 'hover:bg-surface'}>
      <Td className="max-w-[16rem] py-2.5">
        <span className="block truncate font-medium" title={apiKey.name}>{apiKey.name}</span>
        {apiKey.creator ? <span className="block truncate text-small text-muted">{s.createdBy(apiKey.creator)}</span> : null}
        {apiKey.creatorRemoved ? <span className="block text-small text-muted">{s.creatorRemoved}</span> : null}
      </Td>
      <Td><code className="whitespace-nowrap rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-mono">{apiKey.prefix}…</code></Td>
      <Td className="hidden whitespace-nowrap text-small md:table-cell">{apiKey.created}</Td>
      <Td className="hidden whitespace-nowrap text-small md:table-cell">{apiKey.lastUsed ?? ta.firmX.dash}</Td>
      <Td numeric className="hidden sm:table-cell">{apiKey.checks}</Td>
      <Td><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{apiKey.revoked ? s.revoked : k.active}</StatusChip></Td>
      <Td>
        <span className="flex justify-end">
          {apiKey.revoked ? null : <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{s.revoke}</Button>}
        </span>
        <ConfirmDialog
          open={open} onClose={() => setOpen(false)} tone="danger"
          title={s.revokeTitle(apiKey.name)} description={s.revokeText} confirmLabel={s.revokeConfirm}
          onConfirm={revoke}
        />
      </Td>
    </tr>
  );
}

/** Admin: create a key (shown once, with a copy button), see this month's use, revoke a key by name. */
export function ApiKeysPanel({ initial, title }: { initial: Keys; title: string }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.integrations;
  const k = ta.mgX.settings.keys;
  const queryClient = useQueryClient();
  const { data } = useSeededQuery(api.account.apiKeys, initial);
  const n = (v: number): string => fmtNumber(locale, v);
  const max = data.maxActive;
  const usage = { checks: n(data.usage.checks), requests: n(data.usage.requests), cap: data.monthlyCap === null ? null : n(data.monthlyCap) };
  const keys: ApiKeyRow[] = data.keys.map((x) => ({
    id: x.id, name: x.name, prefix: x.prefix, created: fmtDate(locale, x.createdAt),
    lastUsed: x.lastUsedAt ? fmtDate(locale, x.lastUsedAt) : null, revoked: x.revokedAt !== null, checks: n(x.checksThisMonth),
    // Admins see whose keys exist; a creator who left the team no longer resolves to an email.
    creator: x.createdBy, creatorRemoved: x.creatorRemoved,
  }));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const full = keys.filter((x) => !x.revoked).length >= max;

  const add = useMutation({
    mutationFn: (keyName: string) => api.account.createApiKey({ name: keyName }).catch(() => ({ error: 'failed' as const })),
    onSuccess: async (result) => {
      if ('token' in result && result.token) {
        setToken(result.token);
        setName('');
        setError(null);
        await queryClient.invalidateQueries({ queryKey: queryKey(api.account.apiKeys) });
        return;
      }
      const reason = 'error' in result ? result.error : 'failed';
      setError(reason === 'limit' ? s.limitReached(max) : reason === 'name' ? s.keyNameRequired : s.createFailed);
    },
  });

  const create = (): void => {
    if (name.trim() === '') { setError(s.keyNameRequired); return; }
    add.mutate(name);
  };

  return (
    <Card
      id="api-keys" title={title} flush
      hint={<>{s.apiHint} <Link href="/api-docs" className="font-medium text-brand-ink underline">{s.docs}</Link></>}
    >
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="text-small">{s.usage(usage.checks, usage.requests)} <span className="text-muted">{usage.cap === null ? s.usageNoCap : s.usageCap(usage.cap)}</span></p>

        {full ? <p className="max-w-xl text-small text-muted">{s.limitReached(max)}</p> : (
          <form className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); create(); }} noValidate>
            <Field label={s.keyName} hint={s.keyNameHint} error={error ?? undefined} className="min-w-0 flex-1">
              <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={60} autoComplete="off" />
            </Field>
            <Button type="submit" variant="primary" loading={add.isPending} className="sm:mt-6">{s.create}</Button>
          </form>
        )}

        {token ? (
          <div role="status" className="max-w-2xl space-y-3 rounded-md border border-warn/50 bg-warn-tint p-3.5">
            <p className="text-small font-medium text-warn-ink">{s.once}</p>
            <CopyField label={s.newKey} value={token} mono />
            <Button size="sm" variant="secondary" onClick={() => setToken(null)}>{s.hideKey}</Button>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line">
        {keys.length === 0 ? <EmptyState size="compact" as="h3" title={s.none} /> : (
          <Table label={title} className={FLUSH_TABLE}>
            <thead>
              <tr>
                <Th>{k.name}</Th>
                <Th>{k.key}</Th>
                <Th className="hidden md:table-cell">{k.created}</Th>
                <Th className="hidden md:table-cell">{k.lastUsed}</Th>
                <Th numeric className="hidden sm:table-cell">{k.checks}</Th>
                <Th>{k.status}</Th>
                <Th><span className="sr-only">{ta.mgX.actions}</span></Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((x) => <KeyRow key={x.id} apiKey={x} />)}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
