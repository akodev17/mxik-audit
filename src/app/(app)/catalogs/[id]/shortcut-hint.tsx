'use client';

import { useEffect, useState } from 'react';
import { ta } from '@/lib/i18n-app';

const KEY = 'mxik.shortcuts.seen';

/** One-line keyboard hint, shown until dismissed once. */
export function ShortcutHint({ suppressed }: { suppressed: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try { setVisible(localStorage.getItem(KEY) !== '1'); } catch { setVisible(true); }
  }, []);

  if (!visible || suppressed) return null;
  return (
    <div className="no-print flex items-center gap-3 border-t border-line bg-surface px-5 py-2 text-sm text-muted">
      <span className="font-medium text-fg">{ta.ws.shortcutsTitle}:</span>
      <span className="min-w-0 flex-1 truncate">{ta.ws.shortcuts}</span>
      <button
        type="button" className="font-medium text-brand hover:underline"
        onClick={() => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } setVisible(false); }}
      >
        {ta.ws.shortcutsGotIt}
      </button>
    </div>
  );
}
