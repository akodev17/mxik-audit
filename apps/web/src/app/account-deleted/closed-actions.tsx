'use client';

import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

/** A one-button form whose answer is where the browser goes next (both change the session). */
function RedirectButton({ call, variant, label }: { call: () => Promise<{ redirect: string }>; variant: 'primary' | 'secondary'; label: string }) {
  const { follow, leaving } = useFollow();
  const run = useMutation({ mutationFn: call, onSuccess: (answer) => { follow(answer); } });
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!run.isPending && !leaving) run.mutate();
  };
  return <form onSubmit={submit}><Button type="submit" variant={variant}>{label}</Button></form>;
}

/** An admin of the closed org reopens it. */
export function ReopenButton() {
  const { ta } = useI18n();
  return <RedirectButton call={() => api.account.reopen()} variant="primary" label={ta.security.restore} />;
}

export function SignOutButton() {
  const { ta } = useI18n();
  return <RedirectButton call={() => api.auth.signOut()} variant="secondary" label={ta.security.signOut} />;
}
