'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState, useState, useTransition } from 'react';
import { changeRetention, closeAccount, type DeleteState } from '@/app/actions/security';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { useToast } from '@/ui/toast';

type Props = { retention: number | null; choices: readonly number[]; deleteAfterDays: number };

/** Admin only: export, raw-file retention and closing the account. */
export function DataPanel({ retention, choices, deleteAfterDays }: Props) {
  const { ta } = useI18n();
  const toast = useToast();
  const [value, setValue] = useState<string>(retention === null ? 'never' : String(retention));
  const [busy, start] = useTransition();
  const [state, action, deleting] = useActionState<DeleteState, FormData>(closeAccount, {});

  const save = (next: string): void => {
    setValue(next);
    start(async () => {
      const ok = await changeRetention(next === 'never' ? null : Number(next));
      toast(ok ? ta.security.saved : ta.security.failed, ok ? undefined : { tone: 'error' });
    });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <a href="/api/account/export" className="inline-flex h-9 items-center rounded-ctl border border-line-strong px-3 text-sm font-medium hover:bg-surface">{ta.security.export}</a>
        <p className="max-w-xl text-xs text-muted">{ta.security.exportHint}</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-bold" htmlFor="retention">{ta.security.retention}</label>
        <select id="retention" value={value} disabled={busy} onChange={(e) => save(e.target.value)} className="h-9 rounded-ctl border border-line-strong bg-base px-2 text-sm focus:border-brand focus:outline-none">
          {choices.map((n) => <option key={n} value={String(n)}>{ta.security.retentionDays(n)}</option>)}
          <option value="never">{ta.security.retentionNever}</option>
        </select>
        <p className="max-w-xl text-xs text-muted">{ta.security.retentionHint}</p>
      </div>

      <form action={action} className="max-w-xl space-y-2 rounded-ctl border border-line p-3">
        <h3 className="text-sm font-bold">{ta.security.deleteTitle}</h3>
        <p className="text-xs text-muted">{ta.security.deleteHint(deleteAfterDays)}</p>
        <Input name="password" type="password" required autoComplete="current-password" placeholder={ta.security.deletePassword} aria-label={ta.security.deletePassword} />
        {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
        <Button type="submit" variant="secondary" disabled={deleting}>{ta.security.deleteAction}</Button>
      </form>
    </div>
  );
}
