'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { removeCatalog } from '@/app/actions/catalog';
import { Button } from '@/ui/button';

/** Irreversible, so it always asks first and says exactly what goes. */
export function DeleteCatalogButton({ catalogId, filename }: { catalogId: string; filename: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick(): void {
    if (!window.confirm(t.catalogsDeleteConfirm(filename))) return;
    startBusy(async () => {
      const result = await removeCatalog(catalogId);
      setMessage(result.ok ? t.catalogsDeleted(result.rows) : result.error);
      if (result.ok) router.refresh();
    });
  }

  if (message) return <span role="status" className="text-xs text-muted">{message}</span>;
  return <Button size="sm" variant="danger" onClick={onClick} disabled={busy}>{busy ? t.loading : t.catalogsDelete}</Button>;
}
