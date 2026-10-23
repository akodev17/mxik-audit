'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';

export function RestoreButton({ clientId }: { clientId: string }) {
  const { ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function restore(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.clients.restore({ clientId });
      if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
      toast(ta.firmX.client.restored);
      router.refresh();
    } catch (e) {
      toast(refusalText(e, ta.shellX.ui.confirmFailed), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return <Button size="sm" variant="secondary" loading={busy} onClick={() => { void restore(); }}>{ta.firmX.client.restore}</Button>;
}
