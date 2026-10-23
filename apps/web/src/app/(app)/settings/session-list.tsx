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
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { agoLabel } from './session-rows';

type Sessions = OutputOf<typeof endpoints.auth.sessions>;

/** Signed-in browsers as a table, this device first; ending every other session asks first. */
export function SessionList({ initial }: { initial: Sessions }) {
  const { locale, ta } = useI18n();
  const s = ta.secX.sessions;
  const cols = ta.mgX.settings.sessions;
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
    <Card
      id="sessions" title={ta.security.sessions} hint={ta.security.sessionsHint} flush
      actions={sessions.some((row) => !row.current)
        ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>{ta.security.endOthers}</Button>
        : undefined}
    >
      <Table label={ta.security.sessions} className={FLUSH_TABLE}>
        <thead>
          <tr>
            <Th>{cols.device}</Th>
            <Th className="hidden sm:table-cell">{cols.started}</Th>
            <Th>{cols.lastSeen}</Th>
            <Th><span className="sr-only">{ta.mgX.actions}</span></Th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((row) => {
            const seenAt = fmtDateTime(locale, row.lastSeenAt);
            return (
              <tr key={row.id} className={row.current ? 'bg-good-tint/40' : 'hover:bg-surface'}>
                <Td className="py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.device}</span>
                    {row.current ? <Badge tone="good">{ta.security.current}</Badge> : null}
                  </span>
                </Td>
                <Td className="hidden whitespace-nowrap text-small text-muted sm:table-cell">{fmtDateTime(locale, row.createdAt)}</Td>
                {/* "5 minutes ago" depends on the clock and the runtime's locale data: the browser's may differ from the server's. */}
                <Td className="whitespace-nowrap text-small text-muted"><span title={seenAt} suppressHydrationWarning>{agoLabel(locale, row.lastSeenAt) ?? seenAt}</span></Td>
                <Td>
                  <span className="flex justify-end">
                    {row.current ? null : <Button size="sm" variant="secondary" disabled={busy} onClick={() => end.mutate(row.id)}>{ta.security.endSession}</Button>}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <ConfirmDialog
        open={confirming} onClose={() => setConfirming(false)} tone="danger"
        title={s.endOthersTitle} description={s.endOthersText} confirmLabel={ta.security.endOthers}
        onConfirm={endOthers}
      />
    </Card>
  );
}
