'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';

/** Link to what the notice is about; following it marks the notice read for this user. */
export function NoticeLink({ id, href, unread, className, children }: { id: string; href: string; unread: boolean; className?: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (): void => {
    if (!unread) return;
    // The page changes anyway; a read that fails to record simply stays unread.
    void api.notifications.markRead({ ids: [id] }).then((r) => { if (r.ok) router.refresh(); }).catch(() => undefined);
  };
  return <Link href={href} onClick={onClick} className={className}>{children}</Link>;
}

/** Marks one notice read without leaving the page. */
export function MarkReadButton({ id }: { id: string }) {
  const { ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.notifications.markRead({ ids: [id] });
      if (!result.ok) { toast(ta.shellX.bell.markFailed, { tone: 'error' }); return; }
      router.refresh();
    } catch {
      toast(ta.shellX.bell.markFailed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return <Button size="compact" variant="ghost" loading={busy} onClick={() => { void run(); }}>{ta.shellX.notices.markRead}</Button>;
}

/** Marks everything the user can see as read, for this user only. The page shows it only while something is unread. */
export function MarkAllReadButton() {
  const { ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.notifications.markAllRead();
      if (!result.ok) { toast(ta.shellX.bell.markFailed, { tone: 'error' }); return; }
      toast(ta.shellX.bell.marked);
      router.refresh();
    } catch {
      toast(ta.shellX.bell.markFailed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return <Button loading={busy} onClick={() => { void run(); }}>{ta.shellX.bell.markAll}</Button>;
}
