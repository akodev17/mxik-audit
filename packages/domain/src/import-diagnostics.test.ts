import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCode } from '@tasnivo/core/audit/checks';
import { importDiagnostics, readImportMeta } from './import-diagnostics.js';

const MAP = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4, sales: -1, tnved: -1 };

describe('import diagnostics', () => {
  const rows = [
    ['Guruch', '4780074540164', '06301001001000000', 'kg', '12 000', 'Olma'],
    ['', '', '06301001001000000', 'kg', '5', 'Olma'],
    ['guruch', '4780074540164', '6301001001000000', 'KG', '12,500', 'Nok'],
    ['Shakar', '', '123', 'kg', '7', 'Nok'],
    ['Shakar', '', '', 'dona', '1.5', ''],
  ];

  it('counts dropped, duplicate, malformed and ambiguous rows with examples', () => {
    const d = importDiagnostics(rows, MAP);
    assert.equal(d.rows, 5);
    assert.equal(d.importable, 4);
    assert.deepEqual(d.noName, { count: 1, sample: [2] });
    // Same name (case aside), unit and barcode: one duplicate group.
    assert.deepEqual(d.duplicates, { count: 1, sample: [3], groups: 1 });
    assert.deepEqual(d.badCodes, { count: 2, sample: [3, 4] });
    assert.deepEqual(d.lostZero, { count: 1, sample: [3] });
    assert.deepEqual(d.ambiguousAmounts, { count: 1, sample: [3] });
  });

  it('reads code cells like the audit: digitless placeholders are no code, wrong-length digits are bad codes', () => {
    const codes = [
      ['Olma', '-'], ['Nok', 'yoʻq'], ['Gilos', 'нет'], ['Uzum', 'n/a'],
      ['Shaftoli', '6301001001000000'], ['Anor', '12-34'], ['Behi', '0630 1001 001 000000'], ['Xurmo', ''],
    ];
    const d = importDiagnostics(codes, { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1, tnved: -1 });
    // readCode() gives null for these, so the audit reports MISSING, not NOT_FOUND.
    for (const [, cell] of codes.slice(0, 4)) assert.equal(readCode(cell), null);
    assert.ok(readCode('12-34'));
    assert.deepEqual(d.noCode, { count: 4, sample: [1, 2, 3, 4] });
    // Digits of the wrong length reach the classifier lookup and come back NOT_FOUND.
    assert.deepEqual(d.badCodes, { count: 2, sample: [5, 6] });
    assert.deepEqual(d.lostZero, { count: 1, sample: [5] });
  });

  it('follows the mapping: a different name column drops different rows', () => {
    const d = importDiagnostics(rows, { ...MAP, name: 5, unit: -1, barcode: -1 });
    assert.deepEqual(d.noName, { count: 1, sample: [5] });
    assert.deepEqual(d.duplicates, { count: 2, sample: [2, 4], groups: 2 });
  });

  it('does not call rows duplicates when only their sizes differ', () => {
    // A metal price list: one product name, many sizes. Before sizes were part of the key, all collided.
    const pipes = [
      ['Труба ВГП 15х2,5', '', '', 'тонна'],
      ['Труба ВГП 20х2,5', '', '', 'тонна'],
      ['Трубы эл/св 76х2,5', '', '', 'тонна'],
      ['Трубы эл/св 76х2,8/3,0/3,5', '', '', 'тонна'],
      ['Лист г/к 5,00х1500х6000', '', '', 'тонна'],
      ['Лист г/к 6,00х1500х6000', '', '', 'тонна'],
    ];
    assert.deepEqual(importDiagnostics(pipes, MAP).duplicates, { count: 0, sample: [], groups: 0 });
  });

  it('still calls the same size written two ways a duplicate', () => {
    const drinks = [
      ['Coca-Cola 1.5L', '', '', 'dona'],
      ['Coca Cola 1,5 l', '', '', 'dona'],
      ['Coca-Cola 0.5L', '', '', 'dona'],
      ['Лист г/к 5,00х1500х6000', '', '', 'тонна'],
      ['Лист г/к 5х1500х6000', '', '', 'тонна'],
    ];
    assert.deepEqual(importDiagnostics(drinks, MAP).duplicates, { count: 2, sample: [2, 5], groups: 2 });
  });

  it('reads stored meta back only when it has the expected shape', () => {
    assert.equal(readImportMeta(null), null);
    assert.equal(readImportMeta({ parse: {}, diagnostics: {} }), null);
    const meta = { parse: { totalSeen: 5 }, diagnostics: importDiagnostics(rows, MAP), remembered: null };
    assert.equal(readImportMeta(meta)?.diagnostics.rows, 5);
    // Meta stored before placeholders were counted apart still reads, with none of them.
    const older: Record<string, unknown> = { ...meta.diagnostics };
    delete older['noCode'];
    assert.deepEqual(readImportMeta({ ...meta, diagnostics: older })?.diagnostics.noCode, { count: 0, sample: [] });
  });
});

describe('import diagnostics for the TN VED column', () => {
  const rows = [
    ['Truba', '7306301900'],
    ['Sut', '401201100'],
    ['Choy', '0902.30.000.0'],
    ['List', '72'],
    ['Profil', '-'],
    ['Sement', ''],
    ['Kabel', '85444991011'],
  ];
  const map = { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1, tnved: 1 };

  it('reports cells that are not a 4-10 digit HS code, and those whose leading zero Excel dropped', () => {
    const d = importDiagnostics(rows, map);
    assert.deepEqual(d.badTnved, { count: 2, sample: [4, 7] });
    assert.deepEqual(d.tnvedZero, { count: 1, sample: [2] });
  });

  it('counts nothing when the column is not mapped', () => {
    const d = importDiagnostics(rows, { ...map, tnved: -1 });
    assert.equal(d.badTnved.count + d.tnvedZero.count, 0);
  });

  it('reads meta stored before these counts existed, with none of them', () => {
    const meta = { parse: { totalSeen: 7 }, diagnostics: importDiagnostics(rows, map), remembered: null };
    const older: Record<string, unknown> = { ...meta.diagnostics };
    delete older['badTnved'];
    delete older['tnvedZero'];
    const read = readImportMeta({ ...meta, diagnostics: older });
    assert.deepEqual(read?.diagnostics.badTnved, { count: 0, sample: [] });
    assert.deepEqual(read?.diagnostics.tnvedZero, { count: 0, sample: [] });
    assert.deepEqual(readImportMeta(meta)?.diagnostics.badTnved, { count: 2, sample: [4, 7] });
  });
});
