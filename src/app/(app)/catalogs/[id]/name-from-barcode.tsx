'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, useTransition } from 'react';
import { fillNameFromBarcode } from '@/app/actions/barcode-name';
import type { NameFromBarcode } from '@/lib/barcode-name';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';

/** Offers the classifier's product name for a row whose own name is empty or very short. */
export function NameFromBarcodeOffer({ findingId, offer, readOnly, onFilled }: { findingId: string; offer: NameFromBarcode; readOnly: boolean; onFilled: (name: string) => void }) {
  const { ta } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();
  if (done) return null;
  return (
    <section className="space-y-2 rounded-ctl border border-line bg-surface p-3">
      <h3 className="text-sm font-bold">{ta.barcodeName.title}</h3>
      <p className="text-sm">{offer.name}</p>
      <p className="text-xs text-muted">{ta.barcodeName.hint}</p>
      {readOnly ? null : (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => {
          const ok = await fillNameFromBarcode(findingId);
          toast(ok ? ta.barcodeName.done : ta.ws.failedToast, ok ? undefined : { tone: 'error' });
          if (ok) { setDone(true); onFilled(offer.name); }
        })}>{ta.barcodeName.apply}</Button>
      )}
    </section>
  );
}
