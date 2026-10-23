'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Kbd } from '@/ui/kbd';

/** Every workspace shortcut, opened with "?": one row per key, the keys in a fixed column. */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ta } = useI18n();
  const k = ta.wsX.keys;
  return (
    <Dialog open={open} onClose={onClose} title={k.title} description={k.layoutNote} size="sm" footer={<Button variant="primary" onClick={onClose}>{k.gotIt}</Button>}>
      <dl className="divide-y divide-line rounded-md border border-line text-small">
        {k.list.map(([keys, what]) => (
          <div key={keys} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 px-3 py-2">
            <dt className="flex flex-wrap items-center gap-1">{keys.split(' / ').map((key) => <Kbd key={key}>{key}</Kbd>)}</dt>
            <dd className="text-fg">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
