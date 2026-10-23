'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { DEMO_LIMITS } from '@tasnivo/contracts/modules/demo';
import { DEMO_USE_CASES as USE_CASES } from '@/lib/pure/constants';
import { api } from '@/lib/api/browser';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD, AuthResult } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconMail } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';

type DemoState = Awaited<ReturnType<typeof api.demo.request>>;

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

/** Asks for the demo: name, company, work e-mail and intended use. The access link goes to the e-mail address. */
export function DemoForm({ linkMinutes }: { linkMinutes: number }) {
  const { t } = useI18n();
  const d = t.demoAccess;
  const [state, setState] = useState<DemoState>({});
  const [pending, start] = useTransition();
  // Controlled, so a refused request keeps what was typed.
  const [values, setValues] = useState({ name: '', company: '', email: '', useCase: '' });
  const set = (key: keyof typeof values) => (e: { target: { value: string } }): void => setValues((cur) => ({ ...cur, [key]: e.target.value }));
  const [another, setAnother] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAnother(false);
    start(async () => {
      try {
        setState(await api.demo.request({
          name: text(form, 'name'), company: text(form, 'company'), email: text(form, 'email'),
          useCase: text(form, 'useCase'), website: text(form, 'website'),
        }));
      } catch (error) {
        setState({ error: refusalText(error, t.errorGeneric) });
      }
    });
  };
  if (state.sentTo && !another) {
    return (
      <AuthResult
        icon={<IconMail size={24} />} title={d.sentTitle}
        action={<Button variant="secondary" size="lg" className="w-full" onClick={() => setAnother(true)}>{d.another}</Button>}
      >
        <p>{d.sentBody(state.sentTo, linkMinutes)}</p>
        <p>{d.sentSpam}</p>
      </AuthResult>
    );
  }
  return (
    <form onSubmit={submit} className="relative space-y-5">
      <Field label={d.name}>
        <Input name="name" required maxLength={DEMO_LIMITS.name} autoComplete="name" size="lg" className={AUTH_FIELD} value={values.name} onChange={set('name')} />
      </Field>
      <Field label={d.company}>
        <Input name="company" required maxLength={DEMO_LIMITS.company} autoComplete="organization" size="lg" className={AUTH_FIELD} value={values.company} onChange={set('company')} />
      </Field>
      <Field label={d.email} hint={d.emailHint} error={state.field === 'email' ? state.error : undefined}>
        <Input name="email" type="email" required maxLength={DEMO_LIMITS.email} autoComplete="email" inputMode="email" size="lg" leadingIcon={<IconMail size={16} />} className={AUTH_FIELD} invalid={state.field === 'email'} value={values.email} onChange={set('email')} />
      </Field>
      <Select label={d.useCase} name="useCase" required size="lg" className={AUTH_FIELD} value={values.useCase} onChange={set('useCase')}>
        <option value="" disabled>—</option>
        {USE_CASES.map((u) => <option key={u} value={u}>{d.uses[u]}</option>)}
      </Select>
      {/* Honeypot: hidden from people and from assistive technology; a bot that fills it is ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.error && state.field !== 'email' ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">{d.submit}</Button>
    </form>
  );
}
