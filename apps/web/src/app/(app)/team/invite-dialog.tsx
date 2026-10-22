'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { InviteForm } from './invite-form';
import { useTeam, type Team } from './team-data';

/** `expired`: the plan has run out, which is why no seat is open (rather than every seat being taken). */
type Props = { initial: Team; expired: boolean };

/** The page's primary action: the existing invite form, opened in a dialog. */
export function InviteDialog({ initial, expired }: Props) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const team = useTeam(initial);
  const [open, setOpen] = useState(false);
  const blocked = team.seatsOpen ? null : expired ? ta.msg.gate.expired : s.invite.seatsFull;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{s.inviteCta}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={s.invite.title} size="lg">
        <InviteForm clients={team.clients} mailOn={team.mailEnabled} days={team.inviteDays} blocked={blocked} />
      </Dialog>
    </>
  );
}
