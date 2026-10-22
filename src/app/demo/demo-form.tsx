'use client';

import { useActionState, useState } from 'react';
import { requestDemo, type DemoState } from '@/app/actions/demo';
import { DEMO_LIMITS, USE_CASES } from '@/lib/demo-access-fields';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';

/** Asks for the demo: name, company, work e-mail and intended use. The access link goes to the e-mail address. */
export function DemoForm({ linkMinutes }: { linkMinutes: number }) {
  const { t } = useI18n();
  const d = t.demoAccess;
  const [state, action, pending] = useActionState<DemoState, FormData>(requestDemo, {});
  // Controlled, so a refused request keeps what was typed (the form action resets uncontrolled fields).
  const [values, setValues] = useState({ name: '', company: '', email: '', useCase: '' });
  const set = (key: keyof typeof values) => (e: { target: { value: string } }): void => setValues((cur) => ({ ...cur, [key]: e.target.value }));
  const [another, setAnother] = useState(false);
  if (state.sentTo && !another) {
    return (
      <div role="status" className="mt-6 rounded-ctl border border-line bg-surface p-4 text-sm">
        <p className="font-medium">{d.sentTitle}</p>
        <p className="mt-1 text-muted">{d.sentBody(state.sentTo, linkMinutes)}</p>
        <p className="mt-1 text-muted">{d.sentSpam}</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAnother(true)}>{d.another}</Button>
      </div>
    );
  }
  return (
    <form action={(form) => { setAnother(false); action(form); }} className="relative mt-6 space-y-4">
      <Field label={d.name}>
        <Input name="name" required maxLength={DEMO_LIMITS.name} autoComplete="name" value={values.name} onChange={set('name')} />
      </Field>
      <Field label={d.company}>
        <Input name="company" required maxLength={DEMO_LIMITS.company} autoComplete="organization" value={values.company} onChange={set('company')} />
      </Field>
      <Field label={d.email} hint={d.emailHint} error={state.field === 'email' ? state.error : undefined}>
        <Input name="email" type="email" required maxLength={DEMO_LIMITS.email} autoComplete="email" invalid={state.field === 'email'} value={values.email} onChange={set('email')} />
      </Field>
      <Select label={d.useCase} name="useCase" required value={values.useCase} onChange={set('useCase')}>
        <option value="" disabled>—</option>
        {USE_CASES.map((u) => <option key={u} value={u}>{d.uses[u]}</option>)}
      </Select>
      {/* Honeypot: hidden from people and from assistive technology; a bot that fills it is ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.error && state.field !== 'email' ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : d.submit}</Button>
    </form>
  );
}
