'use client';

import { useState, useTransition } from 'react';
import { startCheckout } from '@/app/actions/billing';
import { t } from '@/lib/i18n';
import { Button } from './button';

type Props = {
  planId: string;
  catalogId: string | null;
  providers: ('click' | 'payme')[];
};

/** Opens the provider's own payment page; nothing is charged here. */
export function PayButtons({ planId, catalogId, providers }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = (provider: 'click' | 'payme') => start(async () => {
    setError(null);
    const result = await startCheckout({ planId, catalogId, provider });
    if (result.ok) window.location.href = result.url;
    else setError(result.error);
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {providers.map((p) => (
        <Button key={p} disabled={busy} onClick={() => go(p)}>{p === 'click' ? t.payClick : t.payPayme}</Button>
      ))}
      {error ? <span role="alert" className="text-sm text-danger">{error}</span> : null}
    </div>
  );
}
