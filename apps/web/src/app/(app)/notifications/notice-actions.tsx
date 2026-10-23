'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { NOTIFICATIONS, useNotices, type NoticePage, type NoticeParams } from './notice-query';

/** After a change, every notifications listing in the cache is read again (this page's included). */
function useRefetchNotices(): () => void {
  const queryClient = useQueryClient();
  return () => { void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS }); };
}

/** Link to what the notice is about; following it marks the notice read for this user. */
export function NoticeLink({ id, href, unread, className, children }: { id: string; href: string; unread: boolean; className?: string; children: ReactNode }) {
  const refetch = useRefetchNotices();
  const onClick = (): void => {
    if (!unread) return;
    // The page changes anyway; a read that fails to record simply stays unread.
    void api.notifications.markRead({ ids: [id] }).then((r) => { if (r.ok) refetch(); }).catch(() => undefined);
  };
  return <Link href={href} onClick={onClick} className={className}>{children}</Link>;
}

/** Marks one notice read without leaving the page. */
export function MarkReadButton({ id }: { id: string }) {
  const { ta } = useI18n();
  const refetch = useRefetchNotices();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.notifications.markRead({ ids: [id] });
      if (!result.ok) { toast(ta.shellX.bell.markFailed, { tone: 'error' }); return; }
      refetch();
    } catch {
      toast(ta.shellX.bell.markFailed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return <Button size="compact" variant="ghost" loading={busy} onClick={() => { void run(); }}>{ta.shellX.notices.markRead}</Button>;
}

/** Marks everything the user can see as read, for this user only. Shown only while something is unread. */
export function MarkAllReadButton({ params, initial }: { params: NoticeParams; initial: NoticePage }) {
  const { ta } = useI18n();
  const refetch = useRefetchNotices();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { unread } = useNotices(params, initial);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.notifications.markAllRead();
      if (!result.ok) { toast(ta.shellX.bell.markFailed, { tone: 'error' }); return; }
      toast(ta.shellX.bell.marked);
      refetch();
    } catch {
      toast(ta.shellX.bell.markFailed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  if (unread === 0) return null;
  return <Button loading={busy} onClick={() => { void run(); }}>{ta.shellX.bell.markAll}</Button>;
}
