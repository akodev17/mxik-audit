'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';

type Format = ResponseOf<typeof endpoints.bank.formats>['formats'][number];
type Rule = ResponseOf<typeof endpoints.bank.rules>['rules'][number];

/** The org's saved layouts (with the built-in ones listed for reference) and remembered operation rules. */
export function BankSettings({ formats, rules, writable }: { formats: Format[]; rules: Rule[]; writable: boolean }) {
  const { ta } = useI18n();
  const b = ta.bankX;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const saved = formats.filter((f) => !f.builtIn);
  const builtIn = formats.filter((f) => f.builtIn);

  async function remove(kind: 'format' | 'rule', id: string): Promise<void> {
    setBusy(id);
    const result = await orRefused(kind === 'format' ? api.bank.removeFormat({ formatId: id }) : api.bank.removeRule({ ruleId: id }), b.errors.network);
    setBusy(null);
    if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
    toast(kind === 'format' ? b.formats.removed : b.rules.removed);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={b.formats.title} hint={b.formats.hint} as="h2">
        {saved.length === 0 ? <p className="text-data text-muted">{b.formats.empty}</p> : (
          <ul className="divide-y divide-line">
            {saved.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="text-small text-muted">{b.formats.used(f.usedCount)}</span>
                </span>
                {writable ? <Button size="sm" variant="danger-ghost" loading={busy === f.id} onClick={() => void remove('format', f.id)}>{b.formats.remove}</Button> : null}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-4 mb-1 text-small font-semibold text-muted">{b.formats.builtIn}</h3>
        <ul className="space-y-1">
          {builtIn.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-small">
              <span>{f.name}</span>
              <Badge tone={f.verified ? 'good' : 'warn'}>{f.verified ? b.formats.verified : b.formats.unverified}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={b.rules.title} hint={b.rules.hint} as="h2">
        {rules.length === 0 ? <p className="text-data text-muted">{b.rules.empty}</p> : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-data">
                  <span className="text-muted">{b.rules.kinds[r.kind]}: </span>
                  <span className="font-medium">«{r.value}»</span>
                  <span className="text-muted"> → </span>
                  <span>{b.operations[r.operation]}</span>
                  {r.cashFlowItem ? <span className="text-muted"> · {r.cashFlowItem}</span> : null}
                  <span className="block text-small text-muted">{b.rules.hits(r.hits)}</span>
                </span>
                {writable ? <Button size="sm" variant="danger-ghost" loading={busy === r.id} onClick={() => void remove('rule', r.id)}>{b.rules.remove}</Button> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
