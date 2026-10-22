'use client';

import { useState } from 'react';
import { api } from '@/lib/api/browser';
import type { Role } from '@/lib/api/me';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Section } from '@/ui/page';
import { useToast } from '@/ui/toast';
import type { ClientOption } from './access-fields';
import { MemberDialog } from './member-dialog';
import { useRefreshTeam, useTeam, type Team } from './team-data';

export type Member = { id: string; email: string; role: Role; clientIds: string[]; you: boolean };

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

  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="font-medium [overflow-wrap:anywhere]">{member.email}</span>
          {member.you ? <Badge tone="brand">{s.you}</Badge> : null}
        </p>
        {member.you ? <p className="text-micro text-muted">{s.removeSelf}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-small text-muted">
        <Badge>{ta.team.roles[member.role]}</Badge>
        <span className="md:hidden">{access}</span>
      </div>
      <p className="hidden text-small text-muted md:block">{access}</p>
      <div className="mt-1 flex flex-wrap gap-2 md:mt-0 md:flex-nowrap md:justify-end">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{s.edit}</Button>
        {member.you ? null : <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(true)}>{s.remove}</Button>}
      </div>
      <MemberDialog member={member} clients={clients} adminCount={adminCount} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={removing} onClose={() => setRemoving(false)} tone="danger"
        title={s.removeTitle(member.email)} description={s.removeText}
        confirmLabel={s.remove} onConfirm={remove}
      />
    </li>
  );
}

/** Every member with role and client access; edit opens a dialog, removal asks first. */
export function TeamMembers({ members, clients }: { members: Member[]; clients: ClientOption[] }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const adminCount = members.filter((m) => m.role === 'admin').length;
  return (
    <div className="overflow-hidden rounded-ctl border border-line bg-raised">
      <div aria-hidden className="hidden grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1fr)_19rem] gap-x-4 border-b border-line bg-surface px-4 py-2 text-micro font-medium uppercase tracking-wide text-muted md:grid">
        <span>{ta.setX.account.email}</span><span>{s.role}</span><span>{s.access}</span><span />
      </div>
      <ul className="divide-y divide-line">
        {members.map((m) => <MemberRow key={m.id} member={m} clients={clients} adminCount={adminCount} />)}
      </ul>
    </div>
  );
}

/** The members section of the team page, with its count; `you` is the signed-in user's id. */
export function MembersSection({ initial, you }: { initial: Team; you: string }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const team = useTeam(initial);
  const members = team.members.map((m) => ({ ...m, you: m.id === you }));
  return (
    <Section title={s.title} hint={s.memberCount(members.length)}>
      <TeamMembers members={members} clients={team.clients} />
    </Section>
  );
}
