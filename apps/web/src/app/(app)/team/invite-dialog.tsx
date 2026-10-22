'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { InviteForm } from './invite-form';
import type { ClientOption } from './access-fields';

type Props = { clients: ClientOption[]; mailOn: boolean; days: number; blocked: string | null };

/** The page's primary action: the existing invite form, opened in a dialog. */
export function InviteDialog(props: Props) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{s.inviteCta}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={s.invite.title} size="lg">
        <InviteForm {...props} />
      </Dialog>
    </>
  );
}
