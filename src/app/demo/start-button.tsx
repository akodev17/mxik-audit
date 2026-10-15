'use client';

import { useActionState } from 'react';
import { startDemo, type DemoState } from '@/app/actions/demo';
import { t } from '@/lib/i18n';

export function StartDemoButton() {
  const [state, action, pending] = useActionState<DemoState>(startDemo, {});
  return (
    <form action={action} className="mt-8">
      <button type="submit" disabled={pending} className="bg-ink px-5 py-2.5 text-paper disabled:opacity-50">
        {pending ? t.loading : t.demoStart}
      </button>
      {state.error ? (
        <p role="alert" className="mt-4 border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-ink-soft">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
