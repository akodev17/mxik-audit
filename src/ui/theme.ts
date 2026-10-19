// Colour theme of the signed-in app. The .app element carries it as data-theme; app-tokens.css
// maps "dark" to the dark tokens and "system" to the OS preference. No attribute means light.

export type Theme = 'light' | 'dark' | 'system';

export const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

export const THEME_COOKIE = 'mxik_theme';

export const DEFAULT_THEME: Theme = 'light';

/** A cookie or form value as a Theme; anything unknown falls back to light. */
export function parseTheme(value: unknown): Theme {
  return THEMES.find((theme) => theme === value) ?? DEFAULT_THEME;
}
