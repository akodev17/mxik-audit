'use client';

import { useState, useTransition } from 'react';
import { openDemo } from '@/app/actions/demo';
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
          // A successful open redirects (the action never returns); anything returned is a refusal.
          const result = await openDemo(token);
          if (result?.error) setError(result.error);
        })}
      >
        {pending ? t.loading : t.demoAccess.open}
      </Button>
      {error ? <p role="alert" className="mt-4 rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
