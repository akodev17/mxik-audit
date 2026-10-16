'use client';

import { useEffect, useState, useTransition } from 'react';
import { changeFlag, loadComments, postComment } from '@/app/actions/comments';
import type { CommentView } from '@/lib/comments';
import { formatTagOf, useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

type Props = {
  findingId: string;
  flag: string | null;
  readOnly: boolean;
  onChange: (count: number, flag: string | null) => void;
};

/** The row's notes thread, with the "ask the client" and "resolved" flags. Internal only. */
export function RowComments({ findingId, flag, readOnly, onChange }: Props) {
  const { ta, locale } = useI18n();
  const [items, setItems] = useState<CommentView[]>([]);
  const [text, setText] = useState('');
  const [current, setCurrent] = useState(flag);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    void loadComments(findingId).then((c) => { if (live) setItems(c); });
    return () => { live = false; };
  }, [findingId]);
  useEffect(() => setCurrent(flag), [flag]);

  const send = (): void => start(async () => {
    const updated = await postComment({ findingId, body: text });
    if (updated) { setItems(updated); setText(''); onChange(updated.length, current); }
  });
  const toggle = (next: 'ask_client' | 'resolved'): void => start(async () => {
    const value = current === next ? null : next;
    if (await changeFlag({ findingId, flag: value })) { setCurrent(value); onChange(items.length, value); }
  });

  return (
    <section>
      <h3 className="mb-2 text-sm font-bold">{ta.comments.title}</h3>
      <p className="mb-2 text-xs text-muted">{ta.comments.internal}</p>
      {readOnly ? null : (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={current === 'ask_client' ? 'primary' : 'secondary'} disabled={busy} onClick={() => toggle('ask_client')}>{ta.comments.askClient}</Button>
          <Button size="sm" variant={current === 'resolved' ? 'primary' : 'secondary'} disabled={busy} onClick={() => toggle('resolved')}>{ta.comments.resolved}</Button>
        </div>
      )}
      {items.length === 0 ? <p className="text-sm text-muted">{ta.comments.none}</p> : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-ctl bg-surface px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{c.body}</p>
              <p className="mt-1 text-xs text-muted">{c.author ?? ta.activity.system}, {new Date(c.at).toLocaleString(formatTagOf(locale))}</p>
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="mt-3">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={ta.comments.placeholder} aria-label={ta.comments.title}
            className="w-full rounded-ctl border border-line-strong p-2 text-sm focus:border-brand focus:outline-none"
          />
          <Button size="sm" variant="primary" className="mt-1" disabled={busy || text.trim().length === 0} onClick={send}>{ta.comments.add}</Button>
        </div>
      )}
    </section>
  );
}
