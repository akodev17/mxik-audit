'use client';

import { useActionState } from 'react';
import { startDemo, type DemoState } from '@/app/actions/demo';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';

export function StartDemoButton() {
  const [state, action, pending] = useActionState<DemoState>(startDemo, {});
  return (
    <form action={action} className="mt-6">
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : t.demoStart}</Button>
      {state.error ? <p role="alert" className="mt-4 rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}
