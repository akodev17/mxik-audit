'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useToast } from '@/ui/toast';

/** Deletes a statement none of whose lines went to 1C, after a confirmation that names it. */
export function RemoveStatementButton({ batchId, filename, lines }: { batchId: string; filename: string; lines: number }) {
  const { ta } = useI18n();
  const l = ta.bankX.list;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{l.remove}</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={l.removeTitle} description={l.removeBody(filename)} scope={filename} count={lines} countLabel={ta.bankX.lineCount(lines)}
        confirmLabel={l.remove}
        onConfirm={async () => {
          const result = await orRefused(api.bank.remove({ batchId }), ta.bankX.errors.network);
          if (!result.ok) return result;
          toast(l.removed);
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
