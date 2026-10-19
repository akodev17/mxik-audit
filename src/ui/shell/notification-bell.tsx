'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { markAllNotificationsRead, markNotificationsRead, notificationsPreview } from '@/app/actions/shell';
import { fmtDateTime } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { NoticeView } from '@/lib/notifications';
import { Button } from '../button';
import { cx } from '../cx';
import { IconBell } from '../icons';
import { Spinner } from '../spinner';
import { useToast } from '../toast';
import { useDropdown } from './use-dropdown';

type Preview = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: NoticeView[] };

/** Bell with the unread count and a dropdown of the latest six; nothing is marked read just by looking. */
export function NotificationBell({ initialUnread }: { initialUnread: number | null }) {
  const { locale, ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const dd = useDropdown();
  const [unread, setUnread] = useState(initialUnread);
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [marking, setMarking] = useState(false);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const load = useCallback(async () => {
    setPreview({ kind: 'loading' });
    try {
      const result = await notificationsPreview();
      if (!result.ok) { setPreview({ kind: 'failed' }); return; }
      setPreview({ kind: 'ready', items: result.items });
      setUnread(result.unread);
    } catch {
      setPreview({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    if (!dd.open) return;
    void load();
    dd.panel.current?.focus({ preventScroll: true });
  }, [dd.open, dd.panel, load]);

  const openItem = (n: NoticeView): void => {
    dd.close(false);
    if (!n.unread) return;
    // Navigation goes ahead; the count only changes once the server has recorded the read.
    void markNotificationsRead([n.id]).then((r) => { if (r.ok) setUnread(r.unread); }).catch(() => undefined);
  };

  const markAll = async (): Promise<void> => {
    setMarking(true);
    try {
      const result = await markAllNotificationsRead();
      if (!result.ok) { toast(ta.shellX.bell.markFailed, { tone: 'error' }); return; }
      setUnread(result.unread);
      setPreview((p) => (p.kind === 'ready' ? { kind: 'ready', items: p.items.map((n) => ({ ...n, unread: false })) } : p));
      toast(ta.shellX.bell.marked);
      router.refresh();
    } catch {
      toast(ta.shellX.bell.markFailed, { tone: 'error' });
    } finally {
      setMarking(false);
    }
  };

  const count = unread ?? 0;
  return (
    <div ref={dd.root} className="relative" onBlur={dd.onBlur}>
      <button
        ref={dd.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={dd.open}
        aria-controls={dd.open ? dd.panelId : undefined}
        aria-label={unread === null ? ta.shellX.bell.title : ta.shellX.bell.label(count)}
        onClick={() => dd.setOpen(!dd.open)}
        className="relative grid size-control-md place-items-center rounded-ctl text-muted transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg"
      >
        <IconBell />
        {count > 0 ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-on-fill">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
      {dd.open ? (
        <div
          ref={dd.panel}
          id={dd.panelId}
          role="dialog"
          aria-labelledby={`${dd.panelId}-title`}
          tabIndex={-1}
          className={cx(
            'z-dropdown flex max-h-[min(32rem,calc(100dvh-5rem))] flex-col rounded-md border border-line bg-raised text-fg shadow-pop focus-visible:outline-none motion-safe:animate-pop-in',
            'max-sm:fixed max-sm:inset-x-2 max-sm:top-14 sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:w-96',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-line px-3 py-2">
            <h2 id={`${dd.panelId}-title`} className="text-data font-semibold">{ta.shellX.bell.title}</h2>
            {count > 0 ? (
              <Button variant="ghost" size="compact" loading={marking} onClick={() => { void markAll(); }}>{ta.shellX.bell.markAll}</Button>
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {preview.kind === 'loading' ? (
              <div className="flex justify-center py-8 text-muted"><Spinner label={ta.shellX.ui.loading} /></div>
            ) : preview.kind === 'failed' ? (
              <div role="alert" className="flex flex-col items-center gap-2 px-3 py-6 text-center text-small text-muted">
                <p>{ta.shellX.bell.failed}</p>
                <Button size="sm" onClick={() => { void load(); }}>{ta.shellX.bell.retry}</Button>
              </div>
            ) : preview.items.length === 0 ? (
              <p className="px-3 py-8 text-center text-small text-muted">{ta.shellX.bell.empty}</p>
            ) : (
              <ul className="divide-y divide-line">
                {preview.items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href ?? '/notifications'}
                      onClick={() => openItem(n)}
                      className="relative flex gap-2.5 px-3 py-2.5 hover:bg-surface focus-visible:outline-offset-[-2px]"
                    >
                      <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.unread ? 'bg-brand' : 'bg-transparent')} />
                      <span className="min-w-0 flex-1">
                        <span className={cx('line-clamp-2 text-data', n.unread ? 'font-semibold' : 'font-normal')}>
                          {n.unread ? <span className="sr-only">{ta.shellX.bell.unread}: </span> : null}
                          {n.title}
                        </span>
                        <span className="mt-0.5 block truncate text-micro text-muted">
                          {n.client?.name ?? ta.shellX.bell.general} · {fmtDateTime(locale, n.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line p-1">
            <Link href="/notifications" onClick={() => dd.close(false)} className="flex justify-center rounded-sm px-3 py-1.5 text-data font-medium text-brand-ink hover:bg-surface focus-visible:outline-offset-[-2px]">
              {ta.shellX.bell.seeAll}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
