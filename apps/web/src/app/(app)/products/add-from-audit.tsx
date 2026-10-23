'use client';

import { useState } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { fill } from './labels';

/** "Add to product catalogue" on a finished audit: its settled rows become products (domain productsFromAudit). */
export function AddFromAudit({ catalogId }: { catalogId: string }) {
  const { ta, locale } = useI18n();
  const x = ta.productsX;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function add(): Promise<void> {
    setBusy(true);
    try {
      const r = await api.products.fromAudit({ catalogId });
      if (!r.ok) { toast(r.error, { tone: 'error' }); return; }
      toast(fill(x.fromAudit.done, { created: fmtNumber(locale, r.created), updated: fmtNumber(locale, r.updated), rows: fmtNumber(locale, r.rows) }), {
        tone: 'ok', action: { label: x.title, run: () => { window.location.href = '/products'; } },
      });
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return <Button size="sm" variant="ghost" loading={busy} onClick={() => void add()}>{x.actions.fromAudit}</Button>;
}
