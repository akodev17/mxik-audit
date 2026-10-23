'use client';

import { useState } from 'react';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import type { Role } from '@/lib/api/me';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Avatar } from '../_manage/avatar';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { ROLE_TONE } from '../_manage/roles';
import { agoLabel } from '../settings/session-rows';
import type { ClientOption } from './access-fields';
import { MemberDialog } from './member-dialog';
import { useRefreshTeam, useTeam, type Team } from './team-data';

export type Member = { id: string; email: string; role: Role; clientIds: string[]; you: boolean; lastSeenAt?: string | null };


function LastSeen({ at }: { at: string | null | undefined }) {
  const { locale, ta } = useI18n();
  if (!at) return <span className="text-muted">{ta.mgX.team.never}</span>;
  const exact = fmtDateTime(locale, at);
  // "5 minutes ago" depends on the clock and the runtime's locale data: the browser's may differ from the server's.
  return <time dateTime={at} title={exact} suppressHydrationWarning>{agoLabel(locale, at) ?? exact}</time>;
}

function MemberRow({ member, clients, adminCount }: { member: Member; clients: readonly ClientOption[]; adminCount: number }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const toast = useToast();
  const refresh = useRefreshTeam();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const access = member.role === 'admin' || member.clientIds.length === 0 ? s.accessAll : s.accessCount(member.clientIds.length);

  const remove = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const result = await api.team.removeMember({ userId: member.id }).catch(() => ({ ok: false as const, error: s.errors.invalid }));
    if (!result.ok) return result;
    toast(s.removed(member.email));
    await refresh();
    return { ok: true };
  };

  const actions = (
    <>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{s.edit}</Button>
      {member.you ? null : <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(true)}>{s.remove}</Button>}
    </>
  );

  return (
    <tr className="hover:bg-surface">
      <Td className="max-w-[22rem] py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar email={member.email} className="ring-0" />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium" title={member.email}>{member.email}</span>
              {member.you ? <Badge tone="brand" className="shrink-0">{s.you}</Badge> : null}
            </p>
            {/* On a phone the access column is hidden: say it here instead. */}
            <p className="text-small text-muted md:hidden"><Badge tone={ROLE_TONE[member.role]} className="mr-1.5 sm:hidden">{ta.team.roles[member.role]}</Badge>{access}</p>
            {member.you ? <p className="text-micro text-muted">{s.removeSelf}</p> : null}
            {/* On a phone the actions column is hidden too: the buttons sit under the member. */}
            <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">{actions}</div>
          </div>
        </div>
      </Td>
      <Td className="hidden sm:table-cell"><Badge tone={ROLE_TONE[member.role]}>{ta.team.roles[member.role]}</Badge></Td>
      <Td className="hidden text-small text-muted md:table-cell">{access}</Td>
      <Td className="hidden whitespace-nowrap text-small text-muted sm:table-cell"><LastSeen at={member.lastSeenAt} /></Td>
      <Td className="hidden sm:table-cell">
        <div className="flex justify-end gap-1.5">{actions}</div>
        <MemberDialog member={member} clients={clients} adminCount={adminCount} open={editing} onClose={() => setEditing(false)} />
        <ConfirmDialog
          open={removing} onClose={() => setRemoving(false)} tone="danger"
          title={s.removeTitle(member.email)} description={s.removeText}
          confirmLabel={s.remove} onConfirm={remove}
        />
      </Td>
    </tr>
  );
}

/** Every member with role, client access and last activity; edit opens a dialog, removal asks first. */
export function TeamMembers({ members, clients }: { members: Member[]; clients: ClientOption[] }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const m = ta.mgX;
  const adminCount = members.filter((x) => x.role === 'admin').length;
  return (
    <Table label={s.title} className={FLUSH_TABLE}>
      <thead>
        <tr>
          <Th>{m.team.colMember}</Th>
          <Th className="hidden sm:table-cell">{s.role}</Th>
          <Th className="hidden md:table-cell">{s.access}</Th>
          <Th className="hidden sm:table-cell">{m.team.colLastSeen}</Th>
          <Th className="hidden sm:table-cell"><span className="sr-only">{m.actions}</span></Th>
        </tr>
      </thead>
      <tbody>
        {members.map((x) => <MemberRow key={x.id} member={x} clients={clients} adminCount={adminCount} />)}
      </tbody>
    </Table>
  );
}

/** The members card of the team page, with its count; `you` is the signed-in user's id. */
export function MembersSection({ initial, you }: { initial: Team; you: string }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const team = useTeam(initial);
  const members = team.members.map((x) => ({ ...x, you: x.id === you }));
  return (
    <Card id="team-members" title={s.title} hint={s.memberCount(members.length)} flush>
      <TeamMembers members={members} clients={team.clients} />
    </Card>
  );
}
