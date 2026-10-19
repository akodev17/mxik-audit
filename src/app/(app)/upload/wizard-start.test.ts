import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UploadPreview } from '@/lib/upload-preview';
import { followsStart, startKey, startPosition, type WizardStart } from './wizard-start';

const preview = (catalogId: string): UploadPreview => ({
  catalogId, filename: 'k.xlsx', client: { id: 'c1', name: 'Mijoz' }, headers: ['Nomi'], sample: [], rows: 1, parse: null,
  mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1 }, remembered: null,
  fields: { name: 'guess', barcode: 'none', mxik: 'none', unit: 'none', price: 'none', sales: 'none' }, diagnostics: null, previous: null,
});
const map = (id: string): WizardStart => ({ step: 'map', preview: preview(id) });
const processing = (id: string): WizardStart => ({ step: 'processing', catalogId: id });

describe('upload wizard start', () => {
  it('ignores the render of the URL the wizard wrote after reading the file', () => {
    // The wizard went select → check X and wrote /upload?catalog=X; the page now says "map X".
    assert.equal(followsStart(map('X'), { catalogId: 'X', phase: 1 }), false);
  });

  it('keeps a committed upload when the page still describes it (or describes it as processing)', () => {
    assert.equal(followsStart(processing('X'), { catalogId: 'X', phase: 2 }), false);
    assert.equal(followsStart(map('X'), { catalogId: 'X', phase: 2 }), false);
  });

  it('moves on when the same upload was committed elsewhere', () => {
    assert.equal(followsStart(processing('X'), { catalogId: 'X', phase: 1 }), true);
  });

  it('replaces the screen for another upload or a fresh /upload', () => {
    assert.equal(followsStart(map('Y'), { catalogId: 'X', phase: 1 }), true);
    assert.equal(followsStart({ step: 'select' }, { catalogId: 'X', phase: 1 }), true);
    assert.equal(followsStart(map('X'), { catalogId: null, phase: 0 }), true);
  });

  it('keys a start by step, upload and, before a file is chosen, the client', () => {
    assert.equal(startKey(map('X'), 'a'), startKey(map('X'), 'b'));
    assert.notEqual(startKey({ step: 'select' }, 'a'), startKey({ step: 'select' }, 'b'));
    assert.notEqual(startKey(map('X'), 'a'), startKey(processing('X'), 'a'));
    assert.deepEqual(startPosition(processing('X')), { catalogId: 'X', phase: 2 });
  });
});
