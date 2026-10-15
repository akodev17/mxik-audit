'use client';

import { useState, useTransition } from 'react';
import { removeCatalog } from '@/app/actions/catalog';
import { t } from '@/lib/i18n';

/** Irreversible, so it always asks first and says exactly what goes. */
export function DeleteCatalogButton({ catalogId, filename }: { catalogId: string; filename: string }) {
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick(): void {
    if (!window.confirm(t.catalogsDeleteConfirm(filename))) return;
    startBusy(async () => {
      const result = await removeCatalog(catalogId);
      setMessage(result.ok ? t.catalogsDeleted(result.rows) : result.error);
    });
  }

  if (message) return <span role="status" className="text-xs text-ink-soft">{message}</span>;
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      className="whitespace-nowrap text-risk underline hover:text-ink disabled:opacity-50"
    >
      {busy ? t.loading : t.catalogsDelete}
    </button>
  );
}
