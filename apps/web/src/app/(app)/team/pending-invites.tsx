'use client';

import { useState } from 'react';
import { fmtDate } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import type { Role } from '@/lib/api/me';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useToast } from '@/ui/toast';
import { useRefreshTeam, useTeam, type Team } from './team-data';

export type PendingInvite = { id: string; email: string | null; role: Role; clients: number; expires: string; expired: boolean };

type Answer = { ok: true } | { ok: false; error: string };

function InviteRow({ invite, mailOn }: { invite: PendingInvite; mailOn: boolean }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const toast = useToast();
  const refresh = useRefreshTeam();
  const [open, setOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const who = invite.email ?? s.pending.noEmail;
  const failed = (): Answer => ({ ok: false, error: s.errors.invalid });

  const revoke = async (): Promise<Answer> => {
    const result = await api.team.revokeInvite({ inviteId: invite.id }).catch(failed);
    if (!result.ok) return result;
    toast(s.pending.revoked);
    await refresh();
    return { ok: true };
  };

  const resend = async (): Promise<Answer> => {
    const result = await api.team.resendInvite({ inviteId: invite.id }).catch(failed);
    if (!result.ok) return result;
    toast(s.pending.resent(who));
    await refresh();
    return { ok: true };
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={invite.email ? 'font-medium [overflow-wrap:anywhere]' : 'font-medium text-muted'}>{who}</span>
          <Badge>{ta.team.roles[invite.role]}</Badge>
          <Badge tone={invite.expired ? 'warn' : 'info'}>{invite.expired ? s.pending.statusExpired : s.pending.statusPending}</Badge>
        </p>
        <p className="text-small text-muted">
          {invite.role === 'admin' || invite.clients === 0 ? s.accessAll : s.accessCount(invite.clients)} · {invite.expired ? s.pending.expiredOn(invite.expires) : s.pending.expires(invite.expires)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {invite.email && mailOn ? <Button size="sm" variant="secondary" onClick={() => setResending(true)}>{s.pending.resend}</Button> : null}
        <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{s.pending.revoke}</Button>
      </div>
      <ConfirmDialog
        open={resending} onClose={() => setResending(false)}
        title={s.pending.resendTitle(who)} description={s.pending.resendText}
        confirmLabel={s.pending.resend} onConfirm={resend}
      />
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={s.pending.revokeTitle(who)} description={s.pending.revokeText}
        confirmLabel={s.pending.revoke} onConfirm={revoke}
      />
    </li>
  );
}

export function PendingInvites({ initial }: { initial: Team }) {
  const { locale, ta } = useI18n();
  const team = useTeam(initial);
  // Compared with the clock when the list was read, so the server's and the browser's render agree.
  const [now] = useState(() => Date.now());
  const invites: PendingInvite[] = team.invites.map((i) => ({
    id: i.id, email: i.email, role: i.role, clients: i.clientIds.length,
    expires: fmtDate(locale, i.expiresAt), expired: Date.parse(i.expiresAt) <= now,
  }));
  if (invites.length === 0) return <p className="text-small text-muted">{ta.setX.team.pending.none}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-ctl border border-line bg-raised">
      {invites.map((i) => <InviteRow key={i.id} invite={i} mailOn={team.mailEnabled} />)}
    </ul>
  );
}
