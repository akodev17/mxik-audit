'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';

/** Deletes an invoice batch (and its review) after a confirmation that names it. */
export function DeleteInvoiceButton({ batchId, label, lines, after }: { batchId: string; label: string; lines: number; after?: string }) {
  const { ta } = useI18n();
  const d = ta.didoxX;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{d.list.remove}</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={d.list.remove} description={d.list.removeConfirm} scope={label} count={lines}
        confirmLabel={d.list.remove}
        onConfirm={async () => {
          const res = await orRefused(api.didox.remove({ batchId }), ta.shellX.ui.confirmFailed);
          if (!res.ok) return { ok: false, error: 'error' in res ? res.error : ta.shellX.ui.confirmFailed };
          if (after) router.push(after); else router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
