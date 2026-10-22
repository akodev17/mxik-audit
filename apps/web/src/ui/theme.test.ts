import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_THEME, parseTheme, THEME_COOKIE, THEMES } from './theme';

describe('parseTheme', () => {
  it('accepts the three themes', () => {
    for (const theme of THEMES) assert.equal(parseTheme(theme), theme);
  });

  it('falls back to light for anything else', () => {
    assert.equal(DEFAULT_THEME, 'light');
    for (const value of [undefined, null, '', 'Dark', 'auto', 1, {}]) assert.equal(parseTheme(value), 'light');
  });

  it('names its cookie like the locale cookie', () => {
    assert.equal(THEME_COOKIE, 'mxik_theme');
  });
});
