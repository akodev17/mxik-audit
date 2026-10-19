'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Kbd } from '@/ui/kbd';

/** Every workspace shortcut, opened with "?". */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ta } = useI18n();
  const k = ta.wsX.keys;
  return (
    <Dialog open={open} onClose={onClose} title={k.title} description={k.layoutNote} size="sm" footer={<Button variant="primary" onClick={onClose}>{k.gotIt}</Button>}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-small">
        {k.list.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt className="flex flex-wrap gap-1">{keys.split(' / ').map((key) => <Kbd key={key}>{key}</Kbd>)}</dt>
            <dd className="text-fg">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
