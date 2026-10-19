import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { contrastRatio, parseColor, type Rgb } from '../styles/contrast';
import { progressPercent, TRACK, TRACK_CLASS } from './progress';

describe('progressPercent', () => {
  it('rounds to whole percent', () => {
    assert.equal(progressPercent(1, 3), 33);
    assert.equal(progressPercent(2, 3), 67);
    assert.equal(progressPercent(400, 400), 100);
  });

  it('clamps out-of-range values and handles an empty range', () => {
    assert.equal(progressPercent(-5, 100), 0);
    assert.equal(progressPercent(150, 100), 100);
    assert.equal(progressPercent(3, 0), 0);
    assert.equal(progressPercent(Number.NaN, 10), 0);
  });
});

const css = readFileSync(path.join(process.cwd(), 'src', 'styles', 'app-tokens.css'), 'utf8');

/** Colour tokens declared in the first rule whose header contains `marker`. */
function tokens(marker: string): Map<string, string> {
  const open = css.indexOf('{', css.indexOf(marker));
  const body = css.slice(open + 1, css.indexOf('}', open)).replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...body.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]));
}

const light = tokens('@theme static');
const dark = new Map([...light, ...tokens('.app[data-theme="dark"]')]);

function rgb(set: Map<string, string>, name: string): Rgb {
  const parsed = parseColor(set.get(name) ?? '');
  assert.ok(parsed, `--color-${name} is not a colour literal`);
  return parsed;
}

describe('progress track contrast (WCAG 1.4.11)', () => {
  it('uses the tested tokens', () => {
    assert.ok(TRACK_CLASS.split(' ').includes(`bg-${TRACK.well}`));
    assert.ok(TRACK_CLASS.split(' ').includes(`inset-ring-${TRACK.edge}`));
  });

  for (const [name, set] of [['light', light], ['dark', dark]] as const) {
    it(`${name}: the track edge is >= 3:1 on surface, raised and base`, () => {
      for (const bg of ['surface', 'raised', 'base']) {
        const r = contrastRatio(rgb(set, TRACK.edge), rgb(set, bg));
        assert.ok(r >= 3, `${TRACK.edge} on ${bg}: ${r.toFixed(2)}`);
      }
    });

    it(`${name}: brand, good and danger fills are >= 3:1 on the well`, () => {
      for (const fill of ['brand', 'good', 'danger']) {
        const r = contrastRatio(rgb(set, fill), rgb(set, TRACK.well));
        assert.ok(r >= 3, `${fill} on ${TRACK.well}: ${r.toFixed(2)}`);
      }
    });
  }
});
