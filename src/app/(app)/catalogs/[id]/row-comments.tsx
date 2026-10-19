'use client';

import { useEffect, useState } from 'react';
import { changeFlag, loadComments, postComment } from '@/app/actions/comments';
import type { CommentView } from '@/lib/comments';
import { fmtDateTime } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { IconCheck } from '@/ui/icons';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';

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
  const [items, setItems] = useState<CommentView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [current, setCurrent] = useState(flag);
  const [busy, setBusy] = useState<'send' | 'flag' | null>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    setFailed(false);
    loadComments(findingId).then((c) => { if (live) setItems(c); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [findingId]);
  useEffect(() => setCurrent(flag), [flag]);

  async function send(): Promise<void> {
    setBusy('send');
    try {
      const updated = await postComment({ findingId, body: text });
      if (!updated) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      setItems(updated);
      setText('');
      onChange(updated.length, current);
    } catch {
      toast(ta.wsX.toast.network, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(next: 'ask_client' | 'resolved'): Promise<void> {
    const value = current === next ? null : next;
    setBusy('flag');
    try {
      if (!(await changeFlag({ findingId, flag: value }))) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      setCurrent(value);
      onChange(items?.length ?? 0, value);
    } catch {
      toast(ta.wsX.toast.network, { tone: 'error' });
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
