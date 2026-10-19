'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { archiveClientAction, deleteClientAction, renameClientAction } from '@/app/actions/clients';
import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';
import { Menu, type MenuItem } from '@/ui/menu';
import { useToast } from '@/ui/toast';

type Props = { clientId: string; name: string; isDefault: boolean; archived: boolean; catalogs: number };
type Open = 'rename' | 'archive' | 'delete' | null;

/** Admin lifecycle of a client: rename, archive, delete (typed name). The default client can only be renamed. */
export function ClientMenu({ clientId, name, isDefault, archived, catalogs }: Props) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.client;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [draft, setDraft] = useState(name);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (which: Open): void => { setError(null); setDraft(name); setTyped(''); setOpen(which); };
  const items: MenuItem[] = [{ label: words.rename, onSelect: () => show('rename') }];
  if (!isDefault && !archived) items.push({ label: words.archive, onSelect: () => show('archive') });
  if (!isDefault) items.push({ label: words.delete, tone: 'danger', onSelect: () => show('delete') });

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after: () => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) { setError(result.error); return; }
      setOpen(null);
      toast(done);
      after();
    } catch {
      setError(ta.shellX.ui.confirmFailed);
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p role="alert" className="mt-3 text-small font-medium text-danger-ink">{error}</p> : null;
  return (
    <>
      <Menu label={words.menu} items={items} align="end" />

      <Dialog
        open={open === 'rename'} onClose={() => setOpen(null)} title={words.renameTitle} size="sm" dismissible={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>{ta.shellX.ui.cancel}</Button>
            <Button type="submit" form="rename-client" variant="primary" loading={busy}>{words.renameSave}</Button>
          </>
        )}
      >
        <form id="rename-client" onSubmit={(e) => { e.preventDefault(); void run(() => renameClientAction({ clientId, name: draft }), words.renamed, () => router.refresh()); }}>
          <Field label={ta.firmX.clients.nameLabel} hint={ta.firmX.clients.nameHint} error={error ?? undefined} required>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} required minLength={2} maxLength={200} autoComplete="off" />
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={open === 'archive'} onClose={() => setOpen(null)}
        title={words.archiveTitle} description={words.archiveHint} scope={name}
        confirmLabel={words.archiveConfirm}
        onConfirm={async () => {
          const result = await archiveClientAction(clientId);
          if (!result.ok) return result;
          toast(words.archivedDone);
          router.refresh();
          return { ok: true };
        }}
      />

      <Dialog
        open={open === 'delete'} onClose={() => setOpen(null)} title={words.deleteTitle} role="alertdialog" size="sm" dismissible={!busy}
        description={words.deleteHint(fmtNumber(locale, catalogs), catalogs)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>{ta.shellX.ui.cancel}</Button>
            <Button
              type="submit" form="delete-client" variant="danger" loading={busy}
              disabled={typed.replace(/\s+/g, ' ').trim() !== name}
            >
              {words.deleteConfirm}
            </Button>
          </>
        )}
      >
        <form
          id="delete-client"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.replace(/\s+/g, ' ').trim() !== name) return;
            void run(() => deleteClientAction({ clientId, confirmName: typed }), words.deleted, () => router.push('/clients'));
          }}
        >
          <Field label={words.deleteType(name)}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          {errorLine}
        </form>
      </Dialog>
    </>
  );
}
