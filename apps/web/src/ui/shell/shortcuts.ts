// Keyboard shortcuts of the shell. Physical keys (e.code), so Cyrillic layouts open the palette too.

export type KeyLike = {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
};

type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean; readOnly?: boolean } | null;

const TEXT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week', '']);

/** True while the user is typing: a text field, textarea, select or editable element has focus. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as TargetLike;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && TEXT_TYPES.has((el.type ?? '').toLowerCase());
}

/** Ctrl+K or Cmd+K anywhere; "/" only when not typing. */
export function isPaletteShortcut(e: KeyLike, typing: boolean): boolean {
  if (e.isComposing || e.altKey || e.defaultPrevented) return false;
  if (e.code === 'KeyK') return (e.ctrlKey || e.metaKey) && !e.shiftKey;
  if (e.code === 'Slash' || e.code === 'NumpadDivide') return !e.ctrlKey && !e.metaKey && !e.shiftKey && !typing;
  return false;
}

/** Label for the shortcut hint: Cmd on Apple keyboards, Ctrl elsewhere. */
export function shortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}
