// The Didox pages' browser copies (apps/web/src/app/(app)/didox/model.ts) and the contract's value
// lists (packages/contracts/src/modules/didox.ts) must keep answering what the domain answers, and
// every issue code the module can emit must have a label in both languages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DIDOX_ISSUES, SHEET_FIELDS as CONTRACT_SHEET_FIELDS } from '@tasnivo/contracts/modules/didox';
import { statusFor } from '@tasnivo/domain/didox/check';
import { SHEET_FIELDS } from '@tasnivo/domain/didox/sources';
import { ru, uz } from '@tasnivo/i18n/i18n-parts/didox';
import { ru as productsRu, uz as productsUz } from '@tasnivo/i18n/i18n-parts/products';
import { issueText, statusFromIssues } from '@/app/(app)/didox/model';

const CODE = /\b((?:mxik|product|package|unit|totals|quantity|duplicate|seller|barcode|marking)_[a-z_]*[a-z])\b/g;
const codesIn = (text: string): string[] => [...text.matchAll(CODE)].map((m) => m[1] ?? '');

describe('didox web parity', () => {
  it('statusFromIssues is the domain statusFor', () => {
    const cases = [[], [{ severity: 'info' as const }], [{ severity: 'warning' as const }], [{ severity: 'warning' as const }, { severity: 'error' as const }]];
    for (const issues of cases) assert.equal(statusFromIssues(issues), statusFor(issues.map((i) => ({ ...i, code: 'x' }))));
  });

  it('the contract lists the spreadsheet fields the domain maps', () => {
    assert.deepEqual([...CONTRACT_SHEET_FIELDS], [...SHEET_FIELDS]);
  });

  it("every issue code the module emits is labelled in uz and ru: its own in didoxX, the classifier's in productsX", () => {
    // check.ts's header names the module's own codes, then (after "Agent 4's classifier adds") Agent 4's.
    const header = readFileSync('packages/domain/src/didox/check.ts', 'utf8').split('\n').slice(0, 20).join('\n');
    const [own = '', classifier = ''] = header.split("Agent 4's classifier adds");
    for (const code of new Set([...codesIn(own), 'duplicate_invoice'])) assert.ok((DIDOX_ISSUES as readonly string[]).includes(code), `contract misses ${code}`);
    for (const code of DIDOX_ISSUES) {
      assert.ok(uz.didoxX.issues[code], `uz label ${code}`);
      assert.ok(ru.didoxX.issues[code], `ru label ${code}`);
    }
    const theirs = codesIn(classifier);
    assert.ok(theirs.length >= 6, theirs.join(','));
    for (const code of theirs) {
      assert.notEqual(issueText(code, undefined, uz.didoxX.issues, productsUz.productsX.issues), code, `uz label for the classifier's ${code}`);
      assert.notEqual(issueText(code, undefined, ru.didoxX.issues, productsRu.productsX.issues), code, `ru label for the classifier's ${code}`);
    }
  });

  it('issueText fills the classifier labels\' placeholders', () => {
    assert.equal(issueText('unit_conflict', { unit: 'kg', expected: 'dona' }, uz.didoxX.issues, productsUz.productsX.issues), 'Birlik «kg», kod talab qiladi «dona»');
    assert.equal(issueText('nope', undefined, uz.didoxX.issues), 'nope');
  });
});
