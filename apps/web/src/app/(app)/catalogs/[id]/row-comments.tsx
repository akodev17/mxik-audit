'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck } from '@/ui/icons';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';
import { serverChange } from '@/ui/shell/router-cache';
import type { CommentView } from './ws-types';

/** Two letters for an author's avatar: the initials of a name, or the start of an e-mail. */
export function initials(who: string): string {
  const base = who.includes('@') ? who.split('@')[0] ?? who : who;
  const parts = base.split(/[s._-]+/).filter(Boolean);
  const text = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : base.slice(0, 2);
  return text.toUpperCase();
}

// Avatar tints from the status families' tints and inks (contrast-checked pairs), picked by name.
const AVATAR = ['bg-brand-tint text-brand-ink', 'bg-good-tint text-good-ink', 'bg-info-tint text-info-ink', 'bg-warn-tint text-warn-ink', 'bg-sunken text-fg'] as const;
const hue = (who: string): number => [...who].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR.length;

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
    <div className="space-y-3">
      <p className="text-micro text-muted">{ta.comments.internal}</p>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2" role="group" aria-label={ta.wsX.filter.flag}>
          {(['ask_client', 'resolved'] as const).map((f) => (
            <Button
              key={f} size="sm" variant="secondary" aria-pressed={current === f} disabled={busy !== null}
              className={cx(current === f && 'border-brand bg-brand-tint text-brand-ink')}
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
      {items !== null && items.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-small text-muted">{ta.wsUi.comments.empty}</p> : null}
      {items !== null && items.length > 0 ? (
        <ol className="space-y-3">
          {items.map((c) => {
            const who = c.author ?? ta.activity.system;
            return (
              <li key={c.id} className="flex gap-3">
                <span aria-hidden className={cx('grid size-8 shrink-0 place-items-center rounded-full text-micro font-semibold', AVATAR[hue(who)])}>{initials(who)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-micro">
                    <span className="truncate font-semibold text-fg">{who}</span>
                    <time dateTime={c.at} className="text-muted">{fmtDateTime(locale, c.at)}</time>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg rounded-tl-sm bg-surface px-3 py-2 text-small text-fg">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {readOnly ? null : (
        <form className="rounded-lg border border-line-input bg-raised focus-within:outline-2 focus-within:outline-focus" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(); }}>
          <Textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={ta.comments.placeholder} aria-label={ta.comments.title}
            className="border-0 bg-transparent focus-visible:outline-none"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && busy === null) { e.preventDefault(); void send(); } }}
          />
          <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
            <span className="text-micro text-muted">{ta.wsUi.comments.sendHint}</span>
            <Button type="submit" size="sm" variant="secondary" loading={busy === 'send'} disabled={busy !== null || text.trim().length === 0}>{ta.comments.add}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
