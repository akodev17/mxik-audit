import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasUploadExtension, UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from './upload-file-types.js';
import { ru, uz } from '@tasnivo/i18n/i18n-parts/imports';

describe('upload file types', () => {
  it('accepts .xlsx, .xls and .csv in any case', () => {
    for (const name of ['katalog.xlsx', 'KATALOG.XLSX', 'eski.xls', 'Narxlar.Csv', 'a.b.csv', ' tovarlar.csv ']) {
      assert.equal(hasUploadExtension(name), true, name);
    }
  });

  it('refuses other types, names without an extension and bare extensions', () => {
    for (const name of ['notes.txt', 'katalog.xlsx.txt', 'katalog.pdf', 'katalog.xlsm', 'katalog', 'csv', '.csv', '', 'blob']) {
      assert.equal(hasUploadExtension(name), false, name);
    }
  });

  it('puts every extension in the picker accept list', () => {
    const accept = UPLOAD_ACCEPT.split(',');
    for (const ext of UPLOAD_EXTENSIONS) assert.ok(accept.includes(ext), ext);
  });

  it('has its own messages for a wrong type and a 0-byte file, apart from a missing one', () => {
    for (const e of [uz.importX.errors, ru.importX.errors]) {
      assert.ok(e.fileType && e.zeroBytes && e.none);
      assert.notEqual(e.zeroBytes, e.none);
      assert.notEqual(e.fileType, e.binary);
    }
  });
});
