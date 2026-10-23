'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { catalogKeys, failureText } from '@/lib/catalogs/client';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { IconMore } from '@/ui/icons';
import { Menu } from '@/ui/menu';
import { useToast } from '@/ui/toast';
import { VisuallyHidden } from '@/ui/visually-hidden';

type Props = { catalogId: string; filename: string; clientName: string | null; rowCount: number; canDelete: boolean; refreshAfterDelete: boolean };

/** Open first; deleting sits behind a menu and a confirmation that says what goes and what stays. */
export function CatalogRowActions({ catalogId, filename, clientName, rowCount, canDelete, refreshAfterDelete }: Props) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.catalogs;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    const result = await api.catalogs.remove({ catalogId }).catch((e: unknown) => ({ ok: false as const, error: failureText(e, ta.importX.errors.network) }));
    if (!result.ok) return { ok: false as const, error: result.error };
    toast(words.deleted(fmtNumber(locale, result.rows), result.rows));
    void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    // A list rendered by a server page (the client page until it reads the API) is rendered again.
    if (refreshAfterDelete) router.refresh();
    return { ok: true as const };
  }

  return (
    <span className="flex items-center justify-end gap-1">
      <ButtonLink href={`/catalogs/${catalogId}`} size="sm" variant="secondary" className="relative">
        {ta.catalogs.open}<VisuallyHidden>: {clientName ? `${clientName} — ${filename}` : filename}</VisuallyHidden>
      </ButtonLink>
      {canDelete ? (
        <>
          <Menu
            label={words.more(filename)} iconOnly icon={<IconMore size={16} />} size="sm" align="end"
            items={[{ label: words.delete, tone: 'danger', onSelect: () => setConfirming(true) }]}
          />
          <ConfirmDialog
            open={confirming}
            onClose={() => setConfirming(false)}
            tone="danger"
            title={words.deleteTitle}
            description={words.deleteHint}
            scope={clientName ? `${clientName} — ${filename}` : filename}
            count={rowCount}
            countLabel={words.deleteRows(fmtNumber(locale, rowCount), rowCount)}
            confirmLabel={words.delete}
            onConfirm={remove}
          />
        </>
      ) : null}
    </span>
  );
}
