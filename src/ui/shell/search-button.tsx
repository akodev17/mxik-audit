'use client';

import { useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/locale-client';
import { IconSearch } from '../icons';
import { Kbd } from '../kbd';
import { shortcutLabel } from './shortcuts';

const noop = (): (() => void) => () => undefined;

/** Header trigger of the command palette: a search field with the shortcut from xl up, an icon below (the header tabs need the room). */
export function SearchButton({ onOpen, expanded, controls }: { onOpen: () => void; expanded: boolean; controls?: string }) {
  const { ta } = useI18n();
  // The platform is only known in the browser; the server renders the Ctrl form.
  const shortcut = useSyncExternalStore(noop, () => shortcutLabel(navigator.platform), () => shortcutLabel(''));
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-keyshortcuts="Control+K Meta+K /"
      aria-label={ta.shellX.search.button}
      className="flex h-control-md shrink-0 items-center gap-2 rounded-ctl px-2 text-data text-muted transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg xl:w-64 xl:bg-surface xl:px-3"
    >
      <IconSearch size={18} />
      <span className="hidden xl:inline">{ta.shellX.search.button}</span>
      <span className="ml-auto hidden xl:inline-flex"><Kbd>{shortcut}</Kbd></span>
    </button>
  );
}
