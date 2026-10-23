// Line checks with stubbed product and counterparty interfaces (Agents 1 and 4 fill the real ones).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ProductQuery } from '../products/index.js';
import { checkInvoice, defaultDeps, sameUnit, statusFor, type CheckDeps, type MatchResult, type ProductRecord } from './check.js';
import { parseDidoxDocument, type ParsedInvoice } from './document.js';
import { FIXTURE_DIR } from './fake-server.js';

const parse = (name: string): ParsedInvoice => {
  const r = parseDidoxDocument(JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')), { source: 'didox_json' });
  assert.ok(r.ok);
  return r.invoice;
};

const product = (id: string, over: Partial<ProductRecord> = {}): ProductRecord => ({
  productId: id, name: id, onecRef: null, mxik: null, mxikName: null, packageCode: null, packageName: null, unit: null, barcode: null,
  aliases: [], mxikStatus: 'ok', mxikSuggestion: null, markingRequired: null, ...over,
});

/** A catalogue of products by name prefix; records the queries it received. */
function stubDeps(catalogue: Record<string, ProductRecord | 'ambiguous'>, classify: Record<string, 'invalid' | 'inactive' | 'restricted'> = {}): CheckDeps & { queries: ProductQuery[][] } {
  const queries: ProductQuery[][] = [];
  return {
    queries,
    matchProducts: (_o, _c, lines) => {
      queries.push(lines);
      return Promise.resolve(lines.map((q): MatchResult => {
        const hit = Object.entries(catalogue).find(([prefix]) => q.name.toLowerCase().startsWith(prefix));
        if (!hit) return { status: 'new', chosen: null, candidates: [] };
        if (hit[1] === 'ambiguous') return { status: 'ambiguous', chosen: null, candidates: [{ id: 'a1', label: 'A', confidence: 0.6, basis: 'name_normalized' }, { id: 'a2', label: 'B', confidence: 0.55, basis: 'name_normalized' }] };
        const c = { id: hit[1].productId ?? '', label: hit[1].name, confidence: 0.98, basis: 'name_normalized' as const };
        return { status: 'matched', chosen: c, candidates: [c] };
      }));
    },
    classifyProducts: (_o, lines) => Promise.resolve(lines.map((q) => {
      const status = q.mxik ? classify[q.mxik] : undefined;
      return {
        mxik: q.mxik ?? null, mxikName: null, mxikStatus: status ?? (q.mxik ? 'ok' : 'missing'),
        mxikSuggestion: !q.mxik ? { id: '11111111111111111', label: 'Suggested', confidence: 0.7, basis: 'ai' as const, reason: 'by name' } : null,
        packageCode: null, packageName: null, markingRequired: null, issues: [],
      };
    })),
    matchCounterparties: (_o, refs) => Promise.resolve(refs.map((r) => ({ ...r, match: { status: 'new' as const, chosen: null, candidates: [] } }))),
    productRecords: (_o, ids) => Promise.resolve(ids.flatMap((id) => Object.values(catalogue).filter((p): p is ProductRecord => p !== 'ambiguous' && p.productId === id))),
  };
}

describe('checkInvoice', () => {
  it('with the base-commit stubs: nothing matched, product_unchecked info, statuses from the parser only', async () => {
    const checked = await checkInvoice('org', null, parse('invoice-noisy.json'), defaultDeps);
    assert.deepEqual(checked.lines.map((l) => l.status), ['valid', 'unresolved', 'unresolved', 'unresolved', 'suspicious']);
    assert.ok(checked.lines.every((l) => l.issues.some((i) => i.code === 'product_unchecked' && i.severity === 'info')));
    assert.ok(checked.lines.every((l) => l.payload.product.status === 'unknown' && l.payload.resolved === null));
    assert.deepEqual(checked.batchIssues, [], 'an unknown counterparty match is not "seller unknown"');
  });

  it('folds two spellings into one candidate group: matched once, both lines flagged', async () => {
    const deps = stubDeps({ 'цемент': product('p-cement', { mxik: '02523001001000000', packageName: 'упаковка', unit: 'штук' }) });
    const checked = await checkInvoice('org', 'client', parse('invoice-120-lines.json'), deps);
    const sent = deps.queries[0] ?? [];
    assert.equal(sent.length, 119, '120 lines, two of them one product');
    assert.equal(sent.filter((q) => q.name.toLowerCase().startsWith('цемент')).length, 1);
    const [l4, l8] = [checked.lines[3], checked.lines[7]];
    assert.equal(l4?.groupKey, l8?.groupKey);
    for (const l of [l4, l8]) {
      assert.equal(l?.payload.product.status, 'matched');
      assert.equal(l?.payload.resolved?.productId, 'p-cement');
      assert.deepEqual(l?.issues.find((i) => i.code === 'duplicate_line_name')?.params, { lines: '4, 8' });
    }
  });

  it('MXIK conflict with the catalogue, package and unit mismatch', async () => {
    const deps = stubDeps({
      'цемент': product('p1', { mxik: '02523001001999999', packageName: 'мешок' }),
      'арматура': product('p2', { mxik: '07214001001000000', packageName: 'штук' }),
      'кирпич': product('p3', { mxik: '06904001001000000', unit: 'тонна' }),
    });
    const checked = await checkInvoice('org', null, parse('invoice-standard-3.json'), deps);
    const [cement, rebar, brick] = checked.lines;
    assert.deepEqual(cement?.issues.map((i) => [i.code, i.suggestion]), [['mxik_conflict', '02523001001999999']]);
    assert.equal(cement?.status, 'suspicious');
    assert.deepEqual(rebar?.issues.map((i) => i.code), ['package_mismatch'], '"тонна" vs "штук"');
    assert.deepEqual(brick?.issues.map((i) => [i.code, i.params?.['invoice'], i.params?.['catalogue']]), [['unit_mismatch', 'штук', 'тонна']]);
    assert.deepEqual(checked.batchIssues.map((i) => i.code), ['seller_unknown']);
  });

  it('new and ambiguous products; the catalogue fills a missing MXIK as a warning', async () => {
    const deps = stubDeps({ 'сахар': product('p-sugar', { mxik: '17019910001000000' }), 'мука': 'ambiguous' });
    const checked = await checkInvoice('org', null, parse('invoice-noisy.json'), deps);
    const [oil, sugar, flour, rice] = checked.lines;
    assert.deepEqual(oil?.issues.map((i) => i.code), ['product_new']);
    assert.deepEqual(sugar?.issues.map((i) => [i.code, i.severity, i.suggestion]), [['mxik_missing', 'warning', '17019910001000000']]);
    assert.equal(sugar?.status, 'suspicious');
    assert.deepEqual(flour?.issues.map((i) => i.code), ['mxik_invalid', 'product_ambiguous']);
    // No catalogue product: the classifier's proposal rides on the error.
    assert.deepEqual(rice?.issues.map((i) => [i.code, i.severity, i.suggestion]), [['mxik_missing', 'error', '11111111111111111'], ['product_new', 'warning', undefined]]);
  });

  it('inactive and restricted codes from the classifier are errors', async () => {
    const deps = stubDeps({}, { '02523001001000000': 'inactive', '07214001001000000': 'restricted', '06904001001000000': 'invalid' });
    const checked = await checkInvoice('org', null, parse('invoice-standard-3.json'), deps);
    assert.deepEqual(checked.lines.map((l) => l.issues.filter((i) => i.severity === 'error').map((i) => i.code)), [['mxik_inactive'], ['mxik_restricted'], ['mxik_invalid']]);
    assert.ok(checked.lines.every((l) => l.status === 'unresolved'));
  });

  it('statusFor and unit comparison', () => {
    assert.equal(statusFor([]), 'valid');
    assert.equal(statusFor([{ code: 'x', severity: 'info' }]), 'valid');
    assert.equal(statusFor([{ code: 'x', severity: 'warning' }]), 'suspicious');
    assert.equal(statusFor([{ code: 'x', severity: 'warning' }, { code: 'y', severity: 'error' }]), 'unresolved');
    assert.ok(sameUnit('штук', 'шт'));
    assert.ok(sameUnit('dona', 'шт.'));
    assert.ok(sameUnit('упаковка', 'уп'));
    assert.ok(!sameUnit('мешок', 'шт'));
  });
});
