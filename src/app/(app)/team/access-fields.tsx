'use client';

import { useId } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { Role } from '@/lib/session';
import { Checkbox } from '@/ui/checkbox';
import { Segmented } from '@/ui/segmented';
import { Select } from '@/ui/select';
import type { AccessDraft, ClientAccess } from './team-access';

export type ClientOption = { id: string; name: string; archived: boolean };

const ROLES: Role[] = ['admin', 'accountant', 'viewer'];

type Props = {
  draft: AccessDraft;
  onChange: (next: AccessDraft) => void;
  clients: readonly ClientOption[];
  /** Why the role cannot change (the last admin); null when it can. */
  roleLocked?: string | null;
  /** Field names when the fields post with a form. */
  names?: { role: string; access: string; clients: string };
  clientsError?: string | null;
  disabled?: boolean;
};

/** Role, then client access as an explicit choice: all clients, or a selection of at least one. */
export function AccessFields({ draft, onChange, clients, roleLocked = null, names, clientsError = null, disabled = false }: Props) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const errorId = useId();
  const visible = clients.filter((c) => !c.archived || draft.clientIds.includes(c.id));
  const toggle = (id: string): void => onChange({ ...draft, clientIds: draft.clientIds.includes(id) ? draft.clientIds.filter((x) => x !== id) : [...draft.clientIds, id] });

  return (
    <div className="space-y-4">
      <div>
        <Select
          label={s.role} name={names?.role} value={draft.role} disabled={disabled || roleLocked !== null}
          hint={roleLocked ?? s.roleHints[draft.role]}
          onChange={(e) => onChange({ ...draft, role: e.target.value as Role })}
          wrapperClassName="max-w-xs"
        >
          {ROLES.map((r) => <option key={r} value={r}>{ta.team.roles[r]}</option>)}
        </Select>
        {/* A disabled select does not post; keep the value in the form. */}
        {names && roleLocked !== null ? <input type="hidden" name={names.role} value={draft.role} /> : null}
      </div>

      {draft.role === 'admin' ? (
        <p className="text-small text-muted">{s.adminSeesAll}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-small font-medium">{s.access}</p>
          <Segmented<ClientAccess>
            label={s.access} name={names?.access} value={draft.access} disabled={disabled} className="max-w-full flex-wrap"
            options={[{ value: 'all', label: s.accessAll }, { value: 'selected', label: s.accessSelected }]}
            onChange={(access) => onChange({ ...draft, access })}
          />
          {draft.access === 'all' ? <p className="text-micro text-muted">{s.accessAllHint}</p> : null}
          {draft.access === 'selected' ? (
            visible.length === 0 ? (
              <p className="text-small text-muted">{s.noClients}</p>
            ) : (
              <fieldset aria-describedby={clientsError ? errorId : undefined} aria-invalid={clientsError ? true : undefined}>
                <legend className="sr-only">{s.clients}</legend>
                <div className="relative grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-line p-2.5 sm:grid-cols-2">
                  {visible.map((c) => (
                    <Checkbox
                      key={c.id} name={names?.clients} value={c.id} disabled={disabled}
                      checked={draft.clientIds.includes(c.id)} onChange={() => toggle(c.id)}
                      label={c.archived ? `${c.name} (${s.archived})` : c.name}
                    />
                  ))}
                </div>
              </fieldset>
            )
          ) : null}
          {clientsError ? <p id={errorId} role="alert" className="text-micro font-medium text-danger-ink">{clientsError}</p> : null}
        </div>
      )}
    </div>
  );
}
