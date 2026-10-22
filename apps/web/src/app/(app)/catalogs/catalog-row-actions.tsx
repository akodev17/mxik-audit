'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { removeCatalog } from '@/app/actions/catalog';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { IconMore } from '@/ui/icons';
import { Menu } from '@/ui/menu';
import { useToast } from '@/ui/toast';
import { VisuallyHidden } from '@/ui/visually-hidden';

type Props = { catalogId: string; filename: string; clientName: string | null; rowCount: number; canDelete: boolean };

/** Open first; deleting sits behind a menu and a confirmation that says what goes and what stays. */
export function CatalogRowActions({ catalogId, filename, clientName, rowCount, canDelete }: Props) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.catalogs;
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    const result = await removeCatalog(catalogId);
    if (!result.ok) return { ok: false as const, error: result.error };
    toast(words.deleted(fmtNumber(locale, result.rows), result.rows));
    router.refresh();
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
