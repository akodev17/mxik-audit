'use client';

import { useI18n } from '@/lib/locale-client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { addApiKey, removeApiKey } from '@/app/actions/api-keys';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

export type ApiKeyRow = { id: string; name: string; prefix: string; created: string; lastUsed: string | null; revoked: boolean; checks: number };

export function ApiKeysPanel({ keys }: { keys: ApiKeyRow[] }) {
  const { ta } = useI18n();
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  const create = (): void => start(async () => {
    const result = await addApiKey(name);
    setFailed(Boolean(result.error));
    if (result.token) { setToken(result.token); setName(''); }
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{ta.apiKeys.intro} <Link href="/api-docs" className="text-brand hover:underline">{ta.apiKeys.docs}</Link></p>
      <div className="flex max-w-xl gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={ta.apiKeys.namePlaceholder} aria-label={ta.apiKeys.namePlaceholder} />
        <Button variant="secondary" disabled={busy || name.trim() === ''} onClick={create}>{ta.apiKeys.create}</Button>
      </div>
      {failed ? <p role="alert" className="text-sm text-danger">{ta.apiKeys.failed}</p> : null}
      {token ? (
        <div className="max-w-xl rounded-ctl border border-line-strong bg-surface p-3">
          <p className="text-sm font-bold">{ta.apiKeys.once}</p>
          <code className="mt-1 block break-all text-sm">{token}</code>
        </div>
      ) : null}
      {keys.length === 0 ? <p className="text-sm text-muted">{ta.apiKeys.none}</p> : (
        <ul className="divide-y divide-line rounded-ctl border border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{k.name}</span> <code className="text-muted">{k.prefix}…</code>
                <span className="block text-xs text-muted">{ta.apiKeys.meta(k.created, k.lastUsed, k.checks)}</span>
              </span>
              {k.revoked ? <Badge tone="neutral">{ta.apiKeys.revoked}</Badge> : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await removeApiKey(k.id); })}>{ta.apiKeys.revoke}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
