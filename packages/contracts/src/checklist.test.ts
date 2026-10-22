import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { checklistOf, README, renderChecklist } from './checklist';
import { allEndpoints } from './registry';

const untick = (text: string) => text.replace(/\[x\]/g, '[ ]');

describe('README checklist', () => {
  it('is what src/checklist.ts generates (run it with --write after changing the registry)', () => {
    // Windows checkouts convert the file to CRLF; the generator always emits LF.
    const current = checklistOf(readFileSync(README, 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(current, 'the checklist markers are missing from README.md');
    assert.equal(untick(current), untick(renderChecklist()));
  });

  it('keeps ticks when regenerated', () => {
    const fresh = renderChecklist();
    const row = fresh.split('\n').find((l) => l.includes('`catalogs.previewUpload`'));
    assert.ok(row);
    const ticked = fresh.replace(row, row.replace('| [ ] | [ ] |', '| [x] | [ ] |'));
    assert.ok(renderChecklist(ticked).includes(row.replace('| [ ] | [ ] |', '| [x] | [ ] |')));
  });

  it('every endpoint names what it replaces', () => {
    assert.deepEqual(allEndpoints().filter((e) => e.replaces.length === 0).map((e) => e.operationId), []);
  });
});
