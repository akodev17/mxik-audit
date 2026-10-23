'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, useTransition } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { Button } from './button';

type Props = {
  planId: string;
  catalogId: string | null;
  providers: ('click' | 'payme')[];
};

/** Opens the provider's own payment page; nothing is charged here. */
export function PayButtons({ planId, catalogId, providers }: Props) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<'click' | 'payme' | null>(null);
  const [busy, start] = useTransition();
  const go = (provider: 'click' | 'payme') => start(async () => {
    setError(null);
    setChosen(provider);
    const result = await orRefused(api.billing.checkout({ planId, catalogId, provider }), t.errorGeneric);
    if (result.ok) window.location.href = result.url;
    else setError(result.error);
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((p) => (
          <Button
            key={p} className="min-w-28 flex-1 sm:flex-none"
            loading={busy && chosen === p} disabled={busy && chosen !== p} onClick={() => go(p)}
          >
            {p === 'click' ? t.payClick : t.payPayme}
          </Button>
        ))}
      </div>
      {error ? <p role="alert" className="text-small text-danger-ink">{error}</p> : null}
    </div>
  );
}
