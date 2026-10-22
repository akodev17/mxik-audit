'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { resendInvite, revokeInvite } from '@/app/actions/team';
import { useI18n } from '@/lib/locale-client';
import type { Role } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useToast } from '@/ui/toast';

export type PendingInvite = { id: string; email: string | null; role: Role; clients: number; expires: string; expired: boolean };

function InviteRow({ invite, mailOn }: { invite: PendingInvite; mailOn: boolean }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const who = invite.email ?? s.pending.noEmail;

  const revoke = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const result = await revokeInvite(invite.id);
    if (!result.ok) return result;
    toast(s.pending.revoked);
    router.refresh();
    return { ok: true };
  };

  const resend = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const result = await resendInvite(invite.id);
    if (!result.ok) return result;
    toast(s.pending.resent(who));
    router.refresh();
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

export function PendingInvites({ invites, mailOn }: { invites: PendingInvite[]; mailOn: boolean }) {
  const { ta } = useI18n();
  if (invites.length === 0) return <p className="text-small text-muted">{ta.setX.team.pending.none}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-ctl border border-line bg-raised">
      {invites.map((i) => <InviteRow key={i.id} invite={i} mailOn={mailOn} />)}
    </ul>
  );
}
