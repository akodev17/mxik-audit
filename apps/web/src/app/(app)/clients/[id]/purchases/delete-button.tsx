'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useToast } from '@/ui/toast';

/** Deletes a purchase list or a cheque/sales list after a confirmation that names it. */
export function DeleteListButton({ listId, kind, scope, rows }: { listId: string; kind: 'purchases' | 'docs'; scope: string; rows: number }) {
  const { ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const copy = kind === 'purchases' ? ta.importX.purchases : ta.importX.docs;
  return (
    <>
      <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{ta.importX.lists.delete}</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={copy.deleteTitle} description={copy.deleteDescription} scope={scope} count={rows}
        confirmLabel={copy.deleteConfirm}
        onConfirm={async () => {
          const call = kind === 'purchases' ? api.imports.removePurchases({ listId }) : api.imports.removeDoc({ listId });
          const result = await orRefused(call, ta.shellX.ui.confirmFailed);
          if (!result.ok) return result;
          toast(ta.importX.lists.deleted);
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
