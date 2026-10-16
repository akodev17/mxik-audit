'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { removePurchases } from '@/app/actions/purchases';
import { t } from '@/lib/i18n';

export function DeletePurchaseButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button" disabled={busy}
      onClick={() => start(async () => { await removePurchases(listId); router.refresh(); })}
      className="text-xs text-ink-soft underline disabled:opacity-50"
    >
      {t.purchasesDelete}
    </button>
  );
}
