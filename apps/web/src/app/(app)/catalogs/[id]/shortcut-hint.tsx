'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

const KEY = 'mxik.shortcuts.seen';

/** One-line keyboard hint, shown until dismissed once; never on touch screens. */
export function ShortcutHint({ suppressed, touch, onHelp }: { suppressed: boolean; touch: boolean; onHelp: () => void }) {
  const { ta } = useI18n();
  const k = ta.wsX.keys;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try { setVisible(localStorage.getItem(KEY) !== '1'); } catch { setVisible(true); }
  }, []);

  if (!visible || suppressed || touch) return null;
  return (
    <div className="no-print hidden items-center gap-3 border-t border-line bg-surface px-5 py-2 text-small text-muted md:flex">
      <span className="font-medium text-fg">{k.footer}:</span>
      <span className="min-w-0 flex-1 truncate">{k.hintLine}</span>
      <Button size="compact" variant="ghost" onClick={onHelp}>{k.open}</Button>
      <Button
        size="compact" variant="ghost"
        onClick={() => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } setVisible(false); }}
      >
        {k.gotIt}
      </Button>
    </div>
  );
}
