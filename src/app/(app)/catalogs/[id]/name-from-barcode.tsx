'use client';

import { useState } from 'react';
import { fillNameFromBarcode } from '@/app/actions/barcode-name';
import type { NameFromBarcode } from '@/lib/barcode-name';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { markServerChange } from '@/ui/shell/router-cache';

/** Offers the classifier's product name for a row whose own name is empty or very short. */
export function NameFromBarcodeOffer({ findingId, offer, readOnly, onFilled }: { findingId: string; offer: NameFromBarcode; readOnly: boolean; onFilled: (name: string) => void }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply(): Promise<void> {
    setBusy(true);
    try {
      const filled = await fillNameFromBarcode(findingId);
      markServerChange();
      if (!filled) { toast(ta.wsX.toast.failed, { tone: 'error' }); return; }
      toast(ta.barcodeName.done);
      setDone(true);
      onFilled(offer.name);
    } catch {
      toast(ta.wsX.toast.network, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;
  return (
    <section className="space-y-2 rounded-ctl border border-line bg-surface p-3">
      <h3 className="text-small font-semibold text-fg">{ta.barcodeName.title}</h3>
      <p className="text-small text-fg">{offer.name}</p>
      <p className="text-micro text-muted">{ta.barcodeName.hint}</p>
      {readOnly ? null : <Button size="sm" variant="secondary" loading={busy} onClick={() => { void apply(); }}>{ta.barcodeName.apply}</Button>}
    </section>
  );
}
