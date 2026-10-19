import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import qrcode from 'qrcode-generator';
import { qrPath } from './qr.js';

/** Reads the drawn cells back out of the path, to compare with the library's own matrix. */
function cells(path: string): Set<string> {
  const out = new Set<string>();
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, run] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < run; i++) out.add(`${x + i},${y}`);
  }
  return out;
}

const URI = 'otpauth://totp/MXIK%20Audit%3Abuxgalter%40firma.uz?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MXIK%20Audit&algorithm=SHA1&digits=6&period=30';

describe('qrPath', () => {
  it('draws exactly the dark modules of the code, inside a 4-module quiet zone', () => {
    const { size, path } = qrPath(URI);
    const qr = qrcode(0, 'M');
    qr.addData(URI, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    assert.equal(size, n + 8);
    const expected = new Set<string>();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) expected.add(`${c + 4},${r + 4}`);
    assert.deepEqual(cells(path), expected);
  });

  it('has the three finder patterns where scanners look for them', () => {
    const { size, path } = qrPath(URI);
    const drawn = cells(path);
    for (const [x0, y0] of [[4, 4], [size - 11, 4], [4, size - 11]] as const) {
      for (let i = 0; i < 7; i++) {
        assert.ok(drawn.has(`${x0 + i},${y0}`) && drawn.has(`${x0 + i},${y0 + 6}`), 'finder edge');
        assert.ok(drawn.has(`${x0},${y0 + i}`) && drawn.has(`${x0 + 6},${y0 + i}`), 'finder edge');
      }
    }
    assert.ok(!drawn.has('0,0'), 'quiet zone stays light');
  });

  it('is deterministic', () => {
    assert.deepEqual(qrPath(URI), qrPath(URI));
  });
});
