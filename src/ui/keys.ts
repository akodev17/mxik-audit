// Pure keyboard helpers shared by menus, segmented controls and overlays.

type Orientation = 'vertical' | 'horizontal';

const STEP: Record<Orientation, Record<string, 1 | -1>> = {
  vertical: { ArrowDown: 1, ArrowUp: -1 },
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
};

/**
 * Index to move to for an arrow, Home or End key in a list of `count` items, wrapping at the ends.
 * `current` is -1 when nothing is focused yet. Null when the key does not navigate.
 */
export function nextIndex(key: string, current: number, count: number, orientation: Orientation = 'vertical'): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const step = STEP[orientation][key];
  if (step === undefined) return null;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** First item after `current` whose label starts with the typed character, wrapping; null when none. */
export function typeaheadIndex(labels: readonly string[], char: string, current: number): number | null {
  if (char.length !== 1 || char === ' ') return null;
  const needle = char.toLocaleLowerCase();
  for (let i = 1; i <= labels.length; i += 1) {
    const at = (current + i + labels.length) % labels.length;
    if ((labels[at] ?? '').trimStart().toLocaleLowerCase().startsWith(needle)) return at;
  }
  return null;
}

type FieldLike = { tagName?: string; type?: string; value?: unknown; isContentEditable?: boolean; textContent?: string | null };

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', '']);

/** True for a text input, textarea or contenteditable that already holds text: Escape there edits, it does not close. */
export function isFilledTextField(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as FieldLike;
  if (el.isContentEditable) return (el.textContent ?? '').length > 0;
  const tag = (el.tagName ?? '').toUpperCase();
  const isText = tag === 'TEXTAREA' || (tag === 'INPUT' && TEXT_INPUTS.has((el.type ?? '').toLowerCase()));
  return isText && typeof el.value === 'string' && el.value.length > 0;
}

/**
 * Where Tab should move inside a focus trap: the index to focus when focus would leave the trap,
 * or null to let the browser move it. `current` is -1 when focus sits on the container itself.
 */
export function trapIndex(current: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return null;
}
