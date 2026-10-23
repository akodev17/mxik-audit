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
import { statusFromIssues } from '@/app/(app)/didox/model';

describe('didox web parity', () => {
  it('statusFromIssues is the domain statusFor', () => {
    const cases = [[], [{ severity: 'info' as const }], [{ severity: 'warning' as const }], [{ severity: 'warning' as const }, { severity: 'error' as const }]];
    for (const issues of cases) assert.equal(statusFromIssues(issues), statusFor(issues.map((i) => ({ ...i, code: 'x' }))));
  });

  it('the contract lists the spreadsheet fields the domain maps', () => {
    assert.deepEqual([...CONTRACT_SHEET_FIELDS], [...SHEET_FIELDS]);
  });

  it('every issue code the module emits is in the contract and labelled in uz and ru', () => {
    // The codes check.ts names in its header comment, plus the duplicate refusal.
    const header = readFileSync('packages/domain/src/didox/check.ts', 'utf8').split('\n').slice(0, 15).join('\n');
    const emitted = [...header.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1] ?? '').filter((c) => (DIDOX_ISSUES as readonly string[]).includes(c) || /^(mxik|product|package|unit|totals|quantity|duplicate|seller)_/.test(c));
    for (const code of new Set([...emitted, 'duplicate_invoice'])) assert.ok((DIDOX_ISSUES as readonly string[]).includes(code), `contract misses ${code}`);
    for (const code of DIDOX_ISSUES) {
      assert.ok(uz.didoxX.issues[code], `uz label ${code}`);
      assert.ok(ru.didoxX.issues[code], `ru label ${code}`);
    }
  });
});
