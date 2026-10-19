'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { endOtherSessions, endSession } from '@/app/actions/security';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';

export type SessionItem = {
  id: string; device: string | null; current: boolean;
  /** Sign-in date and time. */
  created: string;
  /** "5 daqiqa oldin", or the date and time when it is older. */
  seen: string;
  /** Full date and time of the last activity, for the tooltip. */
  seenAt: string;
};

/** Signed-in browsers, this device first; ending every other session asks first. */
export function SessionList({ sessions }: { sessions: SessionItem[] }) {
  const { ta } = useI18n();
  const s = ta.secX.sessions;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const end = (id: string): void => start(async () => { await endSession(id); router.refresh(); });
  const endOthers = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const ended = await endOtherSessions().catch(() => null);
    if (ended === null) return { ok: false, error: s.endFailed };
    router.refresh();
    return { ok: true };
  };

  return (
    <div className="space-y-3">
      <ul className="max-w-2xl divide-y divide-line rounded-md border border-line">
        {sessions.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.device ?? ta.security.unknownDevice}</span>
                {row.current ? <Badge tone="good">{ta.security.current}</Badge> : null}
              </p>
              <p className="text-small text-muted" title={row.seenAt}>{ta.security.lastSeen(row.created, row.seen)}</p>
            </div>
            {row.current ? null : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => end(row.id)}>{ta.security.endSession}</Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.some((row) => !row.current) ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>{ta.security.endOthers}</Button>
      ) : null}
      <ConfirmDialog
        open={confirming} onClose={() => setConfirming(false)} tone="danger"
        title={s.endOthersTitle} description={s.endOthersText} confirmLabel={ta.security.endOthers}
        onConfirm={endOthers}
      />
    </div>
  );
}
