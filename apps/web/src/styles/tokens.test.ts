import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { contrastRatio, parseColor, type Rgb } from './contrast';

const css = readFileSync(path.join(process.cwd(), 'apps', 'web', 'src', 'styles', 'app-tokens.css'), 'utf8');

/** Declarations of the first rule whose header contains `marker`, as name -> value. */
function block(marker: string): Map<string, string> {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `missing block ${marker}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1] ?? '', (m[2] ?? '').trim());
  return out;
}

const theme = block('@theme static');
const root = block(':root {');
const dark = block('.app[data-theme="dark"]');
const system = block('.app[data-theme="system"]');

const light = new Map([...theme, ...root]);
const darkAll = new Map([...light, ...dark]);
const themed = [...theme.keys()].filter((k) => k.startsWith('--color-')).concat(['--elevation-color', '--elevation-color-strong']);

function color(set: Map<string, string>, name: string): Rgb {
  const value = set.get(`--color-${name}`);
  const parsed = value ? parseColor(value) : null;
  assert.ok(parsed, `--color-${name} is not a colour literal: ${value}`);
  return parsed;
}

function ratio(set: Map<string, string>, fg: string, bg: string): number {
  return contrastRatio(color(set, fg), color(set, bg));
}

describe('app tokens', () => {
  it('give every colour token a dark value', () => {
    const missing = themed.filter((name) => !dark.has(name));
    assert.deepEqual(missing, []);
  });

  it('keep the system-dark block identical to the dark block', () => {
    assert.deepEqual([...system.entries()], [...dark.entries()]);
  });

  for (const [name, set] of [['light', light], ['dark', darkAll]] as const) {
    describe(`${name} theme contrast (WCAG 2.2 AA)`, () => {
      it('text: fg, muted and subtle >= 4.5:1 on base, raised and surface', () => {
        for (const text of ['fg', 'muted', 'subtle']) {
          for (const bg of ['base', 'raised', 'surface']) {
            assert.ok(ratio(set, text, bg) >= 4.5, `${text} on ${bg}: ${ratio(set, text, bg).toFixed(2)}`);
          }
        }
        assert.ok(ratio(set, 'inverse', 'fg') >= 4.5, 'inverse on fg');
      });

      it('muted and subtle text stay >= 4.5:1 on wells and every tint (hints inside chips, rows and notices)', () => {
        for (const text of ['muted', 'subtle']) {
          for (const bg of ['sunken', 'brand-tint', 'good-tint', 'warn-tint', 'danger-tint', 'info-tint']) {
            assert.ok(ratio(set, text, bg) >= 4.5, `${text} on ${bg}: ${ratio(set, text, bg).toFixed(2)}`);
          }
        }
        // muted is the stronger of the two: it carries labels and header cells.
        assert.ok(ratio(set, 'muted', 'base') > ratio(set, 'subtle', 'base'), 'muted is darker than subtle');
      });

      it('lines: line-strong reads stronger than line, and both stay visible on base', () => {
        assert.ok(ratio(set, 'line', 'base') >= 1.2, `line on base: ${ratio(set, 'line', 'base').toFixed(2)}`);
        assert.ok(ratio(set, 'line-strong', 'base') > ratio(set, 'line', 'base') + 0.2, 'line-strong vs line');
      });

      it('status ink >= 4.5:1 on its tint and on base', () => {
        for (const family of ['good', 'warn', 'danger', 'info', 'brand']) {
          assert.ok(ratio(set, `${family}-ink`, `${family}-tint`) >= 4.5, `${family}-ink on tint: ${ratio(set, `${family}-ink`, `${family}-tint`).toFixed(2)}`);
          assert.ok(ratio(set, `${family}-ink`, 'base') >= 4.5, `${family}-ink on base`);
        }
      });

      it('fills used as text (brand, good, danger, info) >= 4.5:1 on base, and on-fill >= 4.5:1 on them', () => {
        for (const fill of ['brand', 'good', 'danger', 'info']) {
          assert.ok(ratio(set, fill, 'base') >= 4.5, `${fill} on base: ${ratio(set, fill, 'base').toFixed(2)}`);
          assert.ok(ratio(set, 'on-fill', fill) >= 4.5, `on-fill on ${fill}: ${ratio(set, 'on-fill', fill).toFixed(2)}`);
        }
        assert.ok(ratio(set, 'on-fill', 'brand-hover') >= 4.5, 'on-fill on brand-hover');
        assert.ok(ratio(set, 'on-fill', 'danger-ink') >= 4.5, 'on-fill on pressed danger');
      });

      it('control borders and the focus ring >= 3:1 on base, raised and surface', () => {
        for (const bg of ['base', 'raised', 'surface']) {
          assert.ok(ratio(set, 'line-input', bg) >= 3, `line-input on ${bg}: ${ratio(set, 'line-input', bg).toFixed(2)}`);
          assert.ok(ratio(set, 'focus', bg) >= 3, `focus on ${bg}`);
          assert.ok(ratio(set, 'danger', bg) >= 3, `invalid border on ${bg}`);
        }
        // Segmented: the selected option's brand ring against the surface track.
        assert.ok(ratio(set, 'brand', 'surface') >= 3, `selected segment ring on surface: ${ratio(set, 'brand', 'surface').toFixed(2)}`);
      });
    });
  }

  it('implements the type scale of docs/UI_REFRESH_PLAN.md §2 (size / line height in px)', () => {
    const px = (name: string): string => {
      const size = theme.get(`--text-${name}`);
      const line = theme.get(`--text-${name}--line-height`);
      assert.ok(size && line, `missing --text-${name}`);
      return `${parseFloat(size) * 16}/${parseFloat(line) * 16}`;
    };
    assert.deepEqual(
      Object.fromEntries(['h1', 'title', 'h2', 'section', 'body', 'data', 'small'].map((n) => [n, px(n)])),
      { h1: '24/32', title: '24/32', h2: '18/28', section: '18/28', body: '14/20', data: '13/18', small: '12/16' },
    );
  });

  it('fixes the audited danger chip (was 4.27:1)', () => {
    assert.ok(ratio(light, 'danger-ink', 'danger-tint') > 6);
  });
});
