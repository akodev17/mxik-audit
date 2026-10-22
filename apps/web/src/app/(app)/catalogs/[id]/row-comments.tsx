'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { IconCheck } from '@/ui/icons';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';
import { serverChange } from '@/ui/shell/router-cache';
import type { CommentView } from './ws-types';

type Props = {
  findingId: string;
  flag: string | null;
  readOnly: boolean;
  onChange: (count: number, flag: string | null) => void;
};

/** The row's notes thread, with the "ask the client" and "resolved" flags. Internal only. */
export function RowComments({ findingId, flag, readOnly, onChange }: Props) {
  const { ta, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const thread = useQuery({
    queryKey: ['finding', findingId, 'comments'],
    queryFn: ({ signal }) => api.workspace.comments({ findingId }, { signal }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const items = thread.data ?? null;
  const failed = thread.isError;
  const [text, setText] = useState('');
  const [current, setCurrent] = useState(flag);
  const [busy, setBusy] = useState<'send' | 'flag' | null>(null);

  useEffect(() => setCurrent(flag), [flag]);

  async function send(): Promise<void> {
    setBusy('send');
    try {
      const updated = await serverChange(api.workspace.postComment({ findingId, body: text }));
      if (!updated) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      queryClient.setQueryData<CommentView[]>(['finding', findingId, 'comments'], updated);
      setText('');
      onChange(updated.length, current);
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(next: 'ask_client' | 'resolved'): Promise<void> {
    const value = current === next ? null : next;
    setBusy('flag');
    try {
      if (!(await serverChange(api.workspace.setFlag({ findingId, flag: value })))) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      setCurrent(value);
      onChange(items?.length ?? 0, value);
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h3 className="mb-1 text-small font-semibold text-fg">{ta.comments.title}</h3>
      <p className="mb-2 text-micro text-muted">{ta.comments.internal}</p>
      {readOnly ? null : (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={ta.wsX.filter.flag}>
          {(['ask_client', 'resolved'] as const).map((f) => (
            <Button
              key={f} size="sm" variant="secondary" aria-pressed={current === f} disabled={busy !== null}
              onClick={() => { void toggle(f); }}
            >
              {current === f ? <IconCheck size={14} /> : null}
              {f === 'ask_client' ? ta.comments.askClient : ta.comments.resolved}
            </Button>
          ))}
        </div>
      )}
      {items === null && !failed ? <Spinner label={ta.wsX.drawer.loading} size={14} /> : null}
      {failed ? <p role="alert" className="text-small text-danger-ink">{ta.wsX.toast.network}</p> : null}
      {items !== null && items.length === 0 ? <p className="text-small text-muted">{ta.comments.none}</p> : null}
      {items !== null && items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-ctl bg-surface px-3 py-2 text-small">
              <p className="whitespace-pre-wrap break-words text-fg">{c.body}</p>
              <p className="mt-1 text-micro text-muted">{c.author ?? ta.activity.system}, {fmtDateTime(locale, c.at)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(); }}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={ta.comments.placeholder} aria-label={ta.comments.title} />
          <Button type="submit" size="sm" variant="secondary" className="mt-1" loading={busy === 'send'} disabled={busy !== null || text.trim().length === 0}>{ta.comments.add}</Button>
        </form>
      )}
    </section>
  );
}
