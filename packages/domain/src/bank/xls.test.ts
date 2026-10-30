// The legacy .xls reader on hostile and edge input (review 30 Oct). The real-layout tests read files
// our own BIFF writer made; these build the bytes by hand for what that writer never emits.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readXls, rkValue, XlsError } from './xls.js';

/** A 1 KB OLE header whose FAT count is huge and whose DIFAT chain points at itself. */
function headerBomb(fatCount: number): Buffer {
  const file = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file, 0);
  file.writeUInt16LE(9, 0x1e); // 512-byte sectors
  file.writeUInt16LE(6, 0x20);
  file.writeUInt32LE(fatCount, 0x2c);
  file.writeUInt32LE(0, 0x30);
  file.writeUInt32LE(4096, 0x38);
  file.writeUInt32LE(0xfffffffe, 0x3c);
  file.writeUInt32LE(0, 0x44); // DIFAT at sector 0, which is all zeros: "next DIFAT sector" 0 again
  return file;
}

describe('legacy .xls reader', () => {
  it('a header claiming more FAT sectors than the file holds is refused at once, not grown until the process dies', () => {
    for (const fatCount of [1_000_000, 100_000, 3]) {
      const started = Date.now();
      assert.throws(() => readXls(headerBomb(fatCount)), (e: unknown) => e instanceof XlsError, String(fatCount));
      assert.ok(Date.now() - started < 1_000, `${fatCount}: ${Date.now() - started} ms`);
    }
  });

  it('RK numbers: integers, hundredths and float RKs with the sign bit set (negative amounts)', () => {
    const intRk = (n: number, cents = false): number => ((n << 2) | 0x02 | (cents ? 0x01 : 0)) | 0;
    // A float RK keeps the top 30 bits of the double: -0.5 is 0xBFE00000…, -2.5 is 0xC0040000….
    const floatRk = (high: number, cents = false): number => (high | (cents ? 0x01 : 0)) | 0;
    assert.equal(rkValue(intRk(-5)), -5);
    assert.equal(rkValue(intRk(-123456, true)), -1234.56);
    assert.equal(rkValue(floatRk(0x3fe00000)), 0.5);
    assert.equal(rkValue(floatRk(0xbfe00000)), -0.5);
    assert.equal(rkValue(floatRk(0xc0040000)), -2.5);
    assert.equal(rkValue(floatRk(0xc0040000, true)), -0.025);
  });
});
