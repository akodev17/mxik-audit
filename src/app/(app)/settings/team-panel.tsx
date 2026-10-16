'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { inviteMember, removeMember, revokeInvite, updateMember, type InviteState } from '@/app/actions/team';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

type Role = 'admin' | 'accountant' | 'viewer';
export type Member = { id: string; email: string; role: Role; clientIds: string[]; you: boolean };
export type PendingInvite = { id: string; email: string | null; role: Role; expires: string };
type ClientOption = { id: string; name: string };

const ROLES: Role[] = ['admin', 'accountant', 'viewer'];

function RoleSelect({ value, onChange, name }: { value: Role; onChange?: (r: Role) => void; name?: string }) {
  const { ta } = useI18n();
  return (
    <select
      name={name} value={onChange ? value : undefined} defaultValue={onChange ? undefined : value}
      onChange={onChange ? (e) => onChange(e.target.value as Role) : undefined}
      className="h-9 rounded-ctl border border-line-strong bg-base px-2 text-sm focus:border-brand focus:outline-none"
    >
      {ROLES.map((r) => <option key={r} value={r}>{ta.team.roles[r]}</option>)}
    </select>
  );
}

function ClientPicker({ clients, selected, onToggle, name }: { clients: ClientOption[]; selected: string[]; onToggle?: (id: string) => void; name?: string }) {
  const { ta } = useI18n();
  if (clients.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <legend className="sr-only">{ta.team.clients}</legend>
      {clients.map((c) => (
        <label key={c.id} className="flex items-center gap-1.5">
          <input
            type="checkbox" name={name} value={c.id} className="size-4 accent-[var(--color-brand)]"
            checked={onToggle ? selected.includes(c.id) : undefined} onChange={onToggle ? () => onToggle(c.id) : undefined}
          />
          {c.name}
        </label>
      ))}
    </fieldset>
  );
}

function MemberRow({ member, clients }: { member: Member; clients: ClientOption[] }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [role, setRole] = useState<Role>(member.role);
  const [ids, setIds] = useState<string[]>(member.clientIds);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (): void => start(async () => {
    const result = await updateMember({ userId: member.id, role, clientIds: ids });
    setError(result.ok ? null : result.error ?? '');
    router.refresh();
  });
  const dirty = role !== member.role || ids.slice().sort().join() !== member.clientIds.slice().sort().join();
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium">{member.email}</span>
        {member.you ? <Badge tone="brand">{ta.settings.you}</Badge> : null}
        <RoleSelect value={role} onChange={setRole} />
        {dirty ? <Button size="sm" variant="primary" disabled={busy} onClick={save}>{ta.team.save}</Button> : null}
        {member.you ? null : (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(ta.team.removeConfirm(member.email))) start(async () => { await removeMember(member.id); router.refresh(); }); }}>
            {ta.team.remove}
          </Button>
        )}
      </div>
      {role !== 'admin' ? (
        <div>
          <p className="mb-1 text-xs text-muted">{ids.length === 0 ? ta.team.allClients : ta.team.clients}</p>
          <ClientPicker clients={clients} selected={ids} onToggle={(id) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
    </li>
  );
}

export function TeamPanel({ members, invites, clients, mailOn }: { members: Member[]; invites: PendingInvite[]; clients: ClientOption[]; mailOn: boolean }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteMember, {});
  const [busy, start] = useTransition();
  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line rounded-ctl border border-line">
        {members.map((m) => <MemberRow key={m.id} member={m} clients={clients} />)}
      </ul>

      <form action={action} className="space-y-3 rounded-ctl border border-line p-4">
        <h3 className="text-sm font-bold">{ta.team.invite}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Input name="email" type="email" placeholder={mailOn ? ta.team.emailPlaceholder : ta.team.emailOptional} className="max-w-xs" />
          <RoleSelect name="role" value="accountant" />
        </div>
        <ClientPicker clients={clients} selected={[]} name="clientIds" />
        <Button type="submit" variant="primary" disabled={pending}>{ta.team.createLink}</Button>
        {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
        {state.url ? (
          <div className="rounded-ctl bg-good-tint px-3 py-2 text-sm">
            <p className="font-medium">{state.emailed ? ta.team.emailed : ta.team.linkReady}</p>
            <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded border border-line-strong bg-base px-2 py-1 text-xs" />
          </div>
        ) : null}
      </form>

      {invites.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold">{ta.team.pending}</h3>
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>{i.email ?? ta.team.noEmail} <Badge>{ta.team.roles[i.role]}</Badge> <span className="text-xs text-muted">{i.expires}</span></span>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => start(async () => { await revokeInvite(i.id); router.refresh(); })}>{ta.team.revoke}</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
