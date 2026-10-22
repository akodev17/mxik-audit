'use client';

import { useState, useTransition } from 'react';
import { api } from '@/lib/api/browser';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

export function OpenDemoButton({ token }: { token: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-6">
      <Button
        variant="primary" className="w-full" disabled={pending}
        onClick={() => start(async () => {
          // Runs in the browser: the API's answer sets the demo session cookie here. A successful open
          // answers { redirect }: a full navigation, so every server component reads the new session.
          try {
            const result = await api.demo.open({ token });
            if ('redirect' in result) {
              window.location.assign(result.redirect);
              // Stay pending while the next page loads.
              await new Promise<never>(() => {});
            } else if (result.error) {
              setError(result.error);
            }
          } catch (e) {
            setError(refusalText(e, t.errorGeneric));
          }
        })}
      >
        {pending ? t.loading : t.demoAccess.open}
      </Button>
      {error ? <p role="alert" className="mt-4 rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
