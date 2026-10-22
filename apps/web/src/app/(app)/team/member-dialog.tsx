'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { updateMember } from '@/app/actions/team';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { IconAlert } from '@/ui/icons';
import { useToast } from '@/ui/toast';
import { AccessFields, type ClientOption } from './access-fields';
import { draftError, draftOf, lastAdminLocked, sameAccess, widening, type AccessDraft, type Widening } from './team-access';
import type { Member } from './team-members';

type Props = { member: Member; clients: readonly ClientOption[]; adminCount: number; open: boolean; onClose: () => void };

/** Edit role and client access. Saving "selected" needs a client; widening access asks first. */
export function MemberDialog({ member, clients, adminCount, open, onClose }: Props) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const router = useRouter();
  const toast = useToast();
  const start = draftOf(member);
  const [draft, setDraft] = useState<AccessDraft>(start);
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState<Widening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(member));
    setChecked(false);
    setConfirming(null);
    setError(null);
  }, [open, member]);

  const invalid = draftError(draft);
  const locked = lastAdminLocked(member, adminCount);
  const demote = member.role === 'admin' && draft.role !== 'admin';
  const selfDemote = member.you && demote;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await updateMember({ userId: member.id, role: draft.role, access: draft.access, clientIds: draft.clientIds }).catch(() => ({ ok: false as const, error: s.errors.invalid }));
    setBusy(false);
    if (!result.ok) {
      setConfirming(null);
      setError(result.error);
      return;
    }
    toast(s.saved(member.email));
    onClose();
    router.refresh();
  };

  const submit = (): void => {
    setChecked(true);
    if (invalid) return;
    if (sameAccess(start, draft)) { onClose(); return; }
    const wider = widening(start, draft);
    if (wider) { setConfirming(wider); return; }
    void save();
  };

  const names = (ids: readonly string[]): string => ids.map((id) => clients.find((c) => c.id === id)?.name ?? id).join(', ');

  const footer = confirming ? (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>{s.back}</Button>
      <Button variant="primary" loading={busy} onClick={() => void save()}>{s.widenConfirm}</Button>
    </>
  ) : locked ? ( // the only admin keeps the role and sees every client: nothing to save
    <Button variant="secondary" onClick={onClose}>{s.close}</Button>
  ) : (
    <>
      <Button variant="secondary" disabled={busy} onClick={onClose}>{s.cancel}</Button>
      <Button variant="primary" loading={busy} onClick={submit}>{s.save}</Button>
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} dismissible={!busy} title={confirming ? s.widenTitle : s.editTitle(member.email)} footer={footer}>
      {confirming ? (
        <div className="space-y-2 text-body">
          <p>{s.widenIntro(member.email)}</p>
          <ul className="list-disc space-y-1 pl-5">
            {confirming.role ? <li>{s.widenRole(ta.team.roles[confirming.role])}</li> : null}
            {confirming.allClients ? <li>{s.widenAll}</li> : null}
            {confirming.addedClients.length > 0 ? <li>{s.widenClients(names(confirming.addedClients))}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <AccessFields
            draft={draft} onChange={setDraft} clients={clients} disabled={busy}
            roleLocked={locked ? s.lastAdmin : null}
            clientsError={checked && invalid ? s.pickClient : null}
          />
          {selfDemote ? (
            <p className="flex items-start gap-2 rounded-md bg-warn-tint px-3 py-2 text-small text-warn-ink">
              <IconAlert size={16} className="mt-0.5 shrink-0" />{s.selfDemote}
            </p>
          ) : null}
          {demote ? (
            <p className="flex items-start gap-2 rounded-md bg-warn-tint px-3 py-2 text-small text-warn-ink">
              <IconAlert size={16} className="mt-0.5 shrink-0" />{s.demoteCut}
            </p>
          ) : null}
        </div>
      )}
      {error ? <p role="alert" className="mt-3 text-small text-danger-ink">{error}</p> : null}
    </Dialog>
  );
}
