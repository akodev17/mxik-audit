'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { removeMember } from '@/app/actions/team';
import { useI18n } from '@/lib/locale-client';
import type { Role } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useToast } from '@/ui/toast';
import type { ClientOption } from './access-fields';
import { MemberDialog } from './member-dialog';

export type Member = { id: string; email: string; role: Role; clientIds: string[]; you: boolean };

function MemberRow({ member, clients, adminCount }: { member: Member; clients: readonly ClientOption[]; adminCount: number }) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const access = member.role === 'admin' || member.clientIds.length === 0 ? s.accessAll : s.accessCount(member.clientIds.length);

  const remove = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const result = await removeMember(member.id);
    if (!result.ok) return result;
    toast(s.removed(member.email));
    router.refresh();
    return { ok: true };
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{member.email}</span>
          {member.you ? <Badge tone="brand">{s.you}</Badge> : null}
        </p>
        <p className="text-small text-muted">{ta.team.roles[member.role]} · {access}</p>
        {member.you ? <p className="text-micro text-muted">{s.removeSelf}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
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
  const adminCount = members.filter((m) => m.role === 'admin').length;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {members.map((m) => <MemberRow key={m.id} member={m} clients={clients} adminCount={adminCount} />)}
    </ul>
  );
}
