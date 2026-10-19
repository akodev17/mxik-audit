'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setAccountantsAction } from '@/app/actions/clients';
import type { AssignableAccountant } from '@/lib/client-lifecycle';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog } from '@/ui/dialog';
import { IconError } from '@/ui/icons';
import { useToast } from '@/ui/toast';

/**
 * Admins tick which accountants work on this client. People whose reach would
 * change silently (unrestricted, or this is their only client) are shown but
 * locked, with the reason and where to change it.
 */
export function AccountantsEditor({ clientId, people }: { clientId: string; people: AssignableAccountant[] }) {
  const { ta } = useI18n();
  const words = ta.firmX.client;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.filter((p) => p.assigned).map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = (): void => {
    setPicked(new Set(people.filter((p) => p.assigned).map((p) => p.id)));
    setError(null);
    setOpen(true);
  };
  const toggle = (id: string, on: boolean): void => {
    setPicked((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; });
  };

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await setAccountantsAction({ clientId, userIds: [...picked] });
      if (!result.ok) { setError(result.error); return; }
      toast(words.accountantsSaved);
      setOpen(false);
      router.refresh();
    } catch {
      setError(ta.shellX.ui.confirmFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>{words.accountantsEdit}</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={words.accountantsDialog}
        description={words.accountantsDialogHint}
        dismissible={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{ta.shellX.ui.cancel}</Button>
            <Button variant="primary" loading={busy} onClick={() => { void save(); }} disabled={people.length === 0}>{words.accountantsSave}</Button>
          </>
        )}
      >
        {people.length === 0 ? <p className="text-small text-muted">{words.accountantsEmpty}</p> : (
          <ul className="space-y-3">
            {people.map((p) => {
              const locked = p.unrestricted || p.onlyThis;
              return (
                <li key={p.id}>
                  <Checkbox
                    label={p.email}
                    description={p.unrestricted ? words.accountantsUnrestricted : p.onlyThis ? words.accountantsOnlyThis : undefined}
                    checked={p.unrestricted || picked.has(p.id)}
                    disabled={locked || busy}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-ctl bg-danger-tint px-3 py-2 text-small font-medium text-danger-ink">
            <IconError size={16} className="mt-px shrink-0" />{error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
