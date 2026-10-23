'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused, refusalText } from '@/lib/api/refusal';
import type { Dependant } from '@/lib/pure/types';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Dialog } from '@/ui/dialog';
import { IconAlert } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Menu, type MenuItem } from '@/ui/menu';
import { useToast } from '@/ui/toast';
import { serverChange } from '@/ui/shell/router-cache';
import { goTo } from '@/ui/shell/same-route-links';

type Props = {
  clientId: string; name: string; isDefault: boolean; archived: boolean; catalogs: number;
  /** Members and open invites whose only client this is: deleting would widen them to every client. */
  blockers: Dependant[];
  /** Members left with no active client if this one is archived. */
  stranded: string[];
};
type Open = 'rename' | 'archive' | 'delete' | null;

const TEAM_HREF = '/team';

/** Admin lifecycle of a client: rename, archive, delete (typed name). The default client can only be renamed. */
export function ClientMenu({ clientId, name, isDefault, archived, catalogs, blockers: initialBlockers, stranded }: Props) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.client;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [draft, setDraft] = useState(name);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server re-checks on delete; a refusal it returns replaces what the page was rendered with.
  const [blockers, setBlockers] = useState<Dependant[]>(initialBlockers);
  const blocked = blockers.length > 0;

  const show = (which: Open): void => { setError(null); setDraft(name); setTyped(''); setBlockers(initialBlockers); setOpen(which); };
  const who = (d: Dependant): string => (d.kind === 'invite' ? words.blockerInvite(d.email) : d.email ?? '');
  const items: MenuItem[] = [{ label: words.rename, onSelect: () => show('rename') }];
  if (!isDefault && !archived) items.push({ label: words.archive, onSelect: () => show('archive') });
  if (!isDefault) items.push({ label: words.delete, tone: 'danger', onSelect: () => show('delete') });

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string; blockers?: Dependant[] }>, done: string, after: () => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        if (result.blockers) setBlockers(result.blockers);
        setError(result.error);
        return;
      }
      setOpen(null);
      toast(done);
      after();
    } catch (e) {
      setError(refusalText(e, ta.shellX.ui.confirmFailed));
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p role="alert" className="mt-3 text-small font-medium text-danger-ink">{error}</p> : null;
  return (
    <>
      {/* With rename as the only action (the default client), a menu would hide a single button. */}
      {items.length === 1 ? <Button variant="secondary" onClick={() => show('rename')}>{words.rename}</Button> : <Menu label={words.menu} items={items} align="end" />}

      <Dialog
        open={open === 'rename'} onClose={() => setOpen(null)} title={words.renameTitle} size="sm" dismissible={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>{ta.shellX.ui.cancel}</Button>
            <Button type="submit" form="rename-client" variant="primary" loading={busy}>{words.renameSave}</Button>
          </>
        )}
      >
        <form id="rename-client" onSubmit={(e) => { e.preventDefault(); void run(() => api.clients.rename({ clientId, name: draft }), words.renamed, () => router.refresh()); }}>
          <Field label={ta.firmX.clients.nameLabel} hint={ta.firmX.clients.nameHint} error={error ?? undefined} required>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} required minLength={2} maxLength={200} autoComplete="off" />
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={open === 'archive'} onClose={() => setOpen(null)}
        title={words.archiveTitle}
        description={(
          <>
            {words.archiveHint}
            {stranded.length > 0 ? <PeopleWarning text={words.archiveStranded} people={stranded} teamLabel={words.teamLink} /> : null}
          </>
        )}
        scope={name}
        confirmLabel={words.archiveConfirm}
        onConfirm={async () => {
          const result = await orRefused(api.clients.archive({ clientId }), ta.shellX.ui.confirmFailed);
          if (!result.ok) return result;
          toast(result.stranded.length > 0 ? words.archivedStranded(result.stranded.join(', ')) : words.archivedDone);
          router.refresh();
          return { ok: true };
        }}
      />

      <Dialog
        open={open === 'delete'} onClose={() => setOpen(null)} title={words.deleteTitle} role="alertdialog" size="sm" dismissible={!busy}
        icon={<IconAlert className="text-danger-ink" />}
        description={words.deleteHint(fmtNumber(locale, catalogs), catalogs)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>{ta.shellX.ui.cancel}</Button>
            <Button
              type="submit" form="delete-client" variant="danger" loading={busy}
              disabled={blocked || typed.replace(/\s+/g, ' ').trim() !== name}
            >
              {words.deleteConfirm}
            </Button>
          </>
        )}
      >
        {blocked ? <PeopleWarning text={words.deleteBlocked} people={blockers.map(who)} teamLabel={words.teamLink} alert /> : null}
        <form
          id="delete-client"
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked || typed.replace(/\s+/g, ' ').trim() !== name) return;
            // The pages that listed the client may be held by the router: the next one opened refreshes (router-cache).
            void run(() => serverChange(api.clients.remove({ clientId, confirmName: typed })), words.deleted, () => goTo('/clients', (href) => router.push(href)));
          }}
        >
          <p className="mt-3 text-small">{words.deleteTypeIntro}</p>
          <p className="mb-3 mt-1"><CodeChip code={name} className="select-all whitespace-normal [overflow-wrap:anywhere]" /></p>
          <Field label={ta.firmX.clients.nameLabel}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={blocked} />
          </Field>
          {blocked ? null : errorLine}
        </form>
      </Dialog>
    </>
  );
}

/** Whose access a client change affects, with the way to fix it in Settings → Team. */
function PeopleWarning({ text, people, teamLabel, alert = false }: { text: string; people: string[]; teamLabel: string; alert?: boolean }) {
  return (
    <div role={alert ? 'alert' : undefined} className="mt-3 rounded-md bg-warn-tint px-3 py-2 text-small text-warn-ink">
      <p className="flex items-start gap-2 font-medium"><IconAlert size={16} className="mt-0.5 shrink-0" />{text}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-9 [overflow-wrap:anywhere]">
        {people.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}
      </ul>
      <Link href={TEAM_HREF} className="mt-1.5 inline-block pl-6 font-medium underline">{teamLabel}</Link>
    </div>
  );
}
