'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { agoLabel } from './session-rows';

type Sessions = OutputOf<typeof endpoints.auth.sessions>;

/** Signed-in browsers, this device first; ending every other session asks first. */
export function SessionList({ initial }: { initial: Sessions }) {
  const { locale, ta } = useI18n();
  const s = ta.secX.sessions;
  const queryClient = useQueryClient();
  const { data: sessions } = useSeededQuery(api.auth.sessions, initial);
  const [confirming, setConfirming] = useState(false);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKey(api.auth.sessions) });
  const end = useMutation({ mutationFn: (sid: string) => api.auth.endSession({ sid }), onSettled: refresh });
  const endOthers = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const ended = await api.auth.endOtherSessions().catch(() => null);
    if (ended === null) return { ok: false, error: s.endFailed };
    await refresh();
    return { ok: true };
  };
  const busy = end.isPending;

  return (
    <div className="space-y-3">
      <ul className="max-w-2xl divide-y divide-line rounded-md border border-line">
        {sessions.map((row) => {
          const seenAt = fmtDateTime(locale, row.lastSeenAt);
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.device}</span>
                  {row.current ? <Badge tone="good">{ta.security.current}</Badge> : null}
                </p>
                {/* "5 minutes ago" depends on the clock and the runtime's locale data: the browser's may differ from the server's. */}
                <p className="text-small text-muted" title={seenAt} suppressHydrationWarning>
                  {ta.security.lastSeen(fmtDateTime(locale, row.createdAt), agoLabel(locale, row.lastSeenAt) ?? seenAt)}
                </p>
              </div>
              {row.current ? null : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => end.mutate(row.id)}>{ta.security.endSession}</Button>
              )}
            </li>
          );
        })}
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
