import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@tasnivo/i18n/i18n-app';

describe('account export wording', () => {
  it('has a README and one header per sheet column in both languages', () => {
    const uz = appDict('uz').setX.data.file;
    const ru = appDict('ru').setX.data.file;
    assert.equal(uz.columns.length, 12);
    assert.equal(ru.columns.length, uz.columns.length);
    for (const words of [uz, ru]) {
      assert.match(words.readme, /catalogs\/\*\.xlsx/);
      assert.ok(words.sheet.length > 0 && words.sheet.length <= 31, 'Excel sheet names are at most 31 characters');
    }
  });
});
