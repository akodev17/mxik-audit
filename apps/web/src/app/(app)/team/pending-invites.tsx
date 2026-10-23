'use client';

import { useState } from 'react';
import { fmtDate } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import type { Role } from '@/lib/api/me';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { EmptyState } from '@/ui/empty-state';
import { IconUsers } from '@/ui/icons';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { useRefreshTeam, useTeam, type Team } from './team-data';
import { ROLE_TONE } from '../_manage/roles';

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
  const access = invite.role === 'admin' || invite.clients === 0 ? s.accessAll : s.accessCount(invite.clients);

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

  const tone = invite.expired ? 'warn' : 'info';
  const actions = (
    <>
      {invite.email && mailOn ? <Button size="sm" variant="secondary" onClick={() => setResending(true)}>{s.pending.resend}</Button> : null}
      <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{s.pending.revoke}</Button>
    </>
  );
  return (
    <tr className="hover:bg-surface">
      <Td className="max-w-[20rem] py-2.5">
        <span className={invite.email ? 'block truncate font-medium' : 'block truncate font-medium text-muted'} title={who}>{who}</span>
        <span className="block text-small text-muted md:hidden"><Badge tone={ROLE_TONE[invite.role]} className="mr-1.5 sm:hidden">{ta.team.roles[invite.role]}</Badge>{access}</span>
        {/* On a phone the actions column is hidden: the buttons sit under the address. */}
        <span className="mt-2 flex flex-wrap gap-1.5 sm:hidden">{actions}</span>
      </Td>
      <Td className="hidden sm:table-cell"><Badge tone={ROLE_TONE[invite.role]}>{ta.team.roles[invite.role]}</Badge></Td>
      <Td className="hidden text-small text-muted md:table-cell">{access}</Td>
      <Td>
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{invite.expired ? s.pending.statusExpired : s.pending.statusPending}</StatusChip>
        <span className="mt-0.5 block whitespace-nowrap text-micro text-muted sm:hidden">{invite.expires}</span>
      </Td>
      <Td className="hidden whitespace-nowrap text-small text-muted sm:table-cell">{invite.expires}</Td>
      <Td className="hidden sm:table-cell">
        <div className="flex justify-end gap-1.5">{actions}</div>
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
      </Td>
    </tr>
  );
}

/** Open invitations with their status and expiry; resend by e-mail or revoke, each after a confirmation. */
export function PendingInvites({ initial }: { initial: Team }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.team;
  const team = useTeam(initial);
  // Compared with the clock when the list was read, so the server's and the browser's render agree.
  const [now] = useState(() => Date.now());
  const invites: PendingInvite[] = team.invites.map((i) => ({
    id: i.id, email: i.email, role: i.role, clients: i.clientIds.length,
    expires: fmtDate(locale, i.expiresAt), expired: Date.parse(i.expiresAt) <= now,
  }));
  return (
    <Card id="team-invites" title={s.pending.title} flush={invites.length > 0}>
      {invites.length === 0 ? (
        <EmptyState size="compact" as="h3" icon={<IconUsers size={22} />} title={s.pending.none} />
      ) : (
        <Table label={s.pending.title} className={FLUSH_TABLE}>
          <thead>
            <tr>
              <Th>{ta.setX.account.email}</Th>
              <Th className="hidden sm:table-cell">{s.role}</Th>
              <Th className="hidden md:table-cell">{s.access}</Th>
              <Th>{ta.mgX.settings.keys.status}</Th>
              <Th className="hidden sm:table-cell">{ta.mgX.team.colExpires}</Th>
              <Th className="hidden sm:table-cell"><span className="sr-only">{ta.mgX.actions}</span></Th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => <InviteRow key={i.id} invite={i} mailOn={team.mailEnabled} />)}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
