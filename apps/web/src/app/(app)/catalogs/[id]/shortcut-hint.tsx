'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { IconButton } from '@/ui/icon-button';
import { IconX } from '@/ui/icons';
import { Kbd } from '@/ui/kbd';

const KEY = 'mxik.shortcuts.seen';

/**
 * The keyboard strip under the grid: the five keys that do most of the work, a button for the full
 * list ("?") and a way to hide it for good. Quiet (small muted text on the surface tone), desktop
 * only, never on touch screens.
 */
export function ShortcutHint({ suppressed, touch, onHelp }: { suppressed: boolean; touch: boolean; onHelp: () => void }) {
  const { ta } = useI18n();
  const k = ta.wsUi.keys;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try { setVisible(localStorage.getItem(KEY) !== '1'); } catch { setVisible(true); }
  }, []);

  if (!visible || suppressed || touch) return null;
  const item = (keys: string[], what: string) => (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5">{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
      {what}
    </span>
  );
  return (
    <div className="no-print hidden h-9 items-center gap-4 border-t border-line bg-surface pl-5 pr-2 text-small text-muted md:flex">
      <span className="sr-only">{k.label}:</span>
      <span className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {item(['J', 'K'], k.move)}
        {item(['Enter'], k.accept)}
        {item(['R'], k.reject)}
        {item(['O'], k.open)}
        {item(['F'], k.search)}
      </span>
      <button type="button" onClick={onHelp} className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-medium text-fg hover:bg-sunken">
        <Kbd>?</Kbd>{k.all}
      </button>
      <IconButton
        size="compact" variant="ghost" label={k.hide} icon={<IconX size={14} />} tooltipSide="top" tooltipAlign="end"
        onClick={() => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } setVisible(false); }}
      />
    </div>
  );
}
