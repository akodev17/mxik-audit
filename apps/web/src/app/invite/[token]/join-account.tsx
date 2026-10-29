'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Button } from '@/ui/button';

type Check = OutputOf<typeof endpoints.team.joinCheck>;
type Refusal = { error: string; adminEmail: string | null };

/**
 * A signed-in visitor of an invite link: join with this account (its empty org is closed, plan D5),
 * or why that is not possible and the inviting admin's address. Signing out offers the new-account
 * form on the same page.
 */
export function JoinAccount({ token, email, check }: { token: string; email: string; check: Check }) {
  const { t, ta } = useI18n();
  const i = ta.authX.invite;
  const { follow, leaving } = useFollow();
  const [refusal, setRefusal] = useState<Refusal | null>(check.ok ? null : { error: check.error, adminEmail: check.adminEmail });
  const join = useMutation({
    mutationFn: () => api.team.joinWithAccount({ token }),
    onSuccess: (answer) => { if (!follow(answer) && 'error' in answer) setRefusal({ error: answer.error, adminEmail: answer.adminEmail }); },
    onError: () => setRefusal({ error: t.errorGeneric, adminEmail: null }),
  });
  const signOut = useMutation({
    mutationFn: () => api.auth.signOut(),
    onSettled: () => { window.location.reload(); },
  });
  return (
    <div className="space-y-5">
      <p className="text-body text-muted">{i.asAccount(email)}</p>
      {refusal ? (
        <Alert tone="danger" title={refusal.error}>
          <p>{refusal.adminEmail ? i.contactAdmin(refusal.adminEmail) : i.contactAdminUnknown}</p>
        </Alert>
      ) : (
        <>
          <p className="text-body">{i.moveLead}</p>
          <Button type="button" variant="primary" size="lg" loading={join.isPending || leaving} className="w-full" onClick={() => join.mutate()}>{i.moveAction}</Button>
        </>
      )}
      <Button type="button" variant="secondary" size="lg" loading={signOut.isPending} className="w-full" onClick={() => signOut.mutate()}>{ta.verifyX.otherAccount}</Button>
    </div>
  );
}
