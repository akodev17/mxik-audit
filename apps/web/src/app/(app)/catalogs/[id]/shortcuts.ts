// Workspace keyboard map. Pure, so the rules are testable. Keys are matched by
// physical position (KeyboardEvent.code), so they work on a Cyrillic layout too.
// "/" is not here: the shell's command palette owns it (and Ctrl+K); F searches the catalogue.

export type ShortcutAction = 'next' | 'prev' | 'nextPending' | 'accept' | 'reject' | 'edit' | 'open' | 'undo' | 'help' | 'search';

type KeyInput = { code: string; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean };

/** Decisions and undo never fire from a held-down key. */
const NO_REPEAT: ReadonlySet<ShortcutAction> = new Set(['accept', 'reject', 'undo', 'edit', 'open', 'help', 'search']);

export function shortcutFor(e: KeyInput): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const action = actionOf(e);
  if (!action || (e.repeat && NO_REPEAT.has(action))) return null;
  return action;
}

function actionOf(e: KeyInput): ShortcutAction | null {
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) return 'help';
  // Shift with a letter is never a shortcut: it is too easy to hit by accident while typing.
  if (e.shiftKey && e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return null;
  switch (e.code) {
    case 'KeyJ': case 'ArrowDown': return 'next';
    case 'KeyK': case 'ArrowUp': return 'prev';
    case 'KeyN': return 'nextPending';
    case 'Enter': case 'NumpadEnter': return 'accept';
    case 'KeyR': return 'reject';
    case 'KeyE': return 'edit';
    case 'KeyO': return 'open';
    case 'KeyU': return 'undo';
    case 'KeyF': return 'search';
    default: return null;
  }
}

const INTERACTIVE_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox', 'textbox', 'slider', 'spinbutton', 'separator', 'radio', 'checkbox', 'button', 'link']);

/** Typing fields, buttons, links, menus and options keep their own keys. */
export function ownsKeys(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const role = target.getAttribute('role');
  return role !== null && INTERACTIVE_ROLES.has(role);
}

type NodeLike = { contains(other: never): boolean };

/**
 * Whether a key pressed with `target` focused is meant for the workspace. Focus on the page itself
 * (the body, or <main> and any other ancestor of the workspace) counts: after a client-side
 * navigation the shell moves focus to <main>, and keys must work from there as they do after a reload.
 * Focus inside another part of the page (header, menus, dialogs) is left alone.
 */
export function keysReachWorkspace(target: NodeLike | null, root: NodeLike | null, body: unknown): boolean {
  if (target === null || target === body) return true;
  if (root === null) return false;
  return root.contains(target as never) || target.contains(root as never);
}
