'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { removeDoc } from '@/app/actions/docs';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

export function DeleteDocButton({ listId }: { listId: string }) {
  const { t, ta } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(ta.docs.deleteConfirm)) start(async () => { await removeDoc(listId); router.refresh(); }); }}>
      {t.purchasesDelete}
    </Button>
  );
}
