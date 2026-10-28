import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headingPrefix, mxikHeading, outsideHeading, readTnved, tnvedCode, tnvedHeading } from './tnved.js';

describe('readTnved', () => {
  it('reads a 10-digit code and its heading', () => {
    assert.deepEqual(readTnved('7306301900'), { status: 'ok', code: '7306301900', heading: '7306', restoredZero: false });
  });

  it('ignores separators a customs file or a person puts in', () => {
    assert.equal(tnvedCode('7306.30.190.0'), '7306301900');
    assert.equal(tnvedCode(' 8471 30 000 0 '), '8471300000');
  });

  it('puts back the leading zero Excel drops: HS codes never have an odd length', () => {
    assert.deepEqual(readTnved('702000000'), { status: 'ok', code: '0702000000', heading: '0702', restoredZero: true });
    assert.equal(tnvedHeading('401'), '0401');
  });

  it('accepts a heading, subheading or 8-digit code alone', () => {
    assert.equal(tnvedHeading('2523'), '2523');
    assert.equal(tnvedHeading('252329'), '2523');
    assert.equal(tnvedHeading('25232900'), '2523');
  });

  it('treats a cell without digits as empty and a wrong length or chapter as unreadable', () => {
    assert.deepEqual(readTnved(null), { status: 'empty' });
    assert.deepEqual(readTnved(' - '), { status: 'empty' });
    assert.deepEqual(readTnved('73'), { status: 'bad', digits: '73' });
    assert.deepEqual(readTnved('73063019001'), { status: 'bad', digits: '73063019001' });
    assert.equal(readTnved('0000000000').status, 'bad');
    assert.equal(readTnved('9900000000').status, 'bad');
  });
});

describe('MXIK headings', () => {
  it('a goods code carries the heading in digits 2-5', () => {
    assert.equal(headingPrefix('7306'), '07306');
    assert.equal(mxikHeading('07306001005000008'), '7306');
    assert.equal(mxikHeading('02523002001224005'), '2523');
  });

  it('a service code or anything but 17 digits has no heading, so it is never outside one', () => {
    assert.equal(mxikHeading('10101001001000000'), null);
    assert.equal(mxikHeading('0730600'), null);
    assert.equal(outsideHeading('10101001001000000', '7306'), false);
    assert.equal(outsideHeading('07304001001000000', '7306'), true);
    assert.equal(outsideHeading('07306001001000000', '7306'), false);
  });
});
