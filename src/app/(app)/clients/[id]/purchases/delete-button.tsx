'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { removePurchases } from '@/app/actions/purchases';
import { Button } from '@/ui/button';

export function DeletePurchaseButton({ listId }: { listId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button size="sm" variant="danger" disabled={busy} onClick={() => start(async () => { await removePurchases(listId); router.refresh(); })}>
      {t.purchasesDelete}
    </Button>
  );
}
