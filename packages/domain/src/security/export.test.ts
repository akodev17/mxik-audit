import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import JSZip from 'jszip';
import { db } from '@tasnivo/db';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg } from '../test-fixtures.js';
import { buildAccountExport } from './export.js';

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

describe('account export (database)', { skip: await dbSkipReason() }, () => {
  const orgs: string[] = [];
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('B12: leaves unconfirmed uploads (drafts) out of catalogs.json and catalogs/', async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    const { catalogId } = await makeCatalog(org.orgId, [{ rawName: 'Guruch', suggestedMxik: null, confidence: null }]);
    await db.catalog.create({
      data: { orgId: org.orgId, filename: 'draft.xlsx', rowCount: 1, status: 'uploaded', headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } },
    });
    const zip = await JSZip.loadAsync(await buildAccountExport(org.orgId));
    const listed = JSON.parse(await zip.file('catalogs.json')?.async('string') ?? '[]') as { id: string }[];
    assert.deepEqual(listed.map((c) => c.id), [catalogId]);
    assert.equal(Object.keys(zip.files).filter((name) => name.startsWith('catalogs/') && !zip.files[name]?.dir).length, 1);
  });
});
