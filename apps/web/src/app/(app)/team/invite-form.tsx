'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { inviteMember, type InviteState } from '@/app/actions/team';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { CopyField } from '@/ui/copy-field';
import { Field, Input } from '@/ui/input';
import { Segmented } from '@/ui/segmented';
import { AccessFields, type ClientOption } from './access-fields';
import { draftError, type AccessDraft } from './team-access';

type Kind = 'email' | 'link';
type Props = { clients: ClientOption[]; mailOn: boolean; days: number; blocked: string | null };

const START: AccessDraft = { role: 'accountant', access: 'all', clientIds: [] };

/** Email-bound invites by default; a link without an address only on purpose. */
export function InviteForm({ clients, mailOn, days, blocked }: Props) {
  const { ta } = useI18n();
  const s = ta.setX.team;
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteMember, {});
  const [kind, setKind] = useState<Kind>('email');
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState<AccessDraft>(START);
  const [checked, setChecked] = useState(false);

  // A created invite clears the form for the next one.
  useEffect(() => {
    if (!state.url) return;
    setEmail('');
    setDraft(START);
    setChecked(false);
  }, [state]);

  const localError = checked && draftError(draft) ? s.pickClient : null;

  if (blocked) {
    return (
      <p className="max-w-xl text-small text-muted">
        {blocked} <Link href="/settings?tab=plan" className="font-medium text-brand-ink underline">{s.invite.seatsLink}</Link>
      </p>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <form
        action={action}
        onSubmit={(e) => { setChecked(true); if (draftError(draft)) e.preventDefault(); }}
        className="space-y-4" noValidate
      >
        <div className="space-y-1.5">
          <p className="text-small font-medium">{s.invite.kind}</p>
          <Segmented<Kind>
            label={s.invite.kind} name="kind" value={kind} onChange={setKind} className="max-w-full flex-wrap"
            options={[{ value: 'email', label: s.invite.byEmail }, { value: 'link', label: s.invite.byLink }]}
          />
        </div>
        {kind === 'email' ? (
          <Field className="max-w-md" label={s.invite.email} required error={state.fieldErrors?.email} hint={`${s.invite.emailHint(days)}${mailOn ? '' : ` ${s.invite.noMail}`}`}>
            <Input name="email" type="email" required autoComplete="off" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        ) : (
          <p className="text-small text-muted">{s.invite.linkHint(days)}</p>
        )}
        <AccessFields
          draft={draft} onChange={setDraft} clients={clients}
          names={{ role: 'role', access: 'access', clients: 'clientIds' }}
          clientsError={localError ?? state.fieldErrors?.clients ?? null}
        />
        {state.error ? <p role="alert" className="text-small text-danger-ink">{state.error}</p> : null}
        <Button type="submit" variant="primary" loading={pending}>{s.invite.submit}</Button>
      </form>

      {state.url && !pending ? (
        <div role="status" className="space-y-2 rounded-md border border-good bg-good-tint p-3">
          <p className="text-small text-good-ink">
            {state.email ? (state.emailed ? s.invite.emailed(state.email) : mailOn ? s.invite.mailFailed(state.email) : s.invite.linkReady) : s.invite.linkReady}
          </p>
          <CopyField label={s.invite.link} value={state.url} mono size="compact" />
        </div>
      ) : null}
    </div>
  );
}
