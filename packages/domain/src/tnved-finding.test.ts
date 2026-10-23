// TNVED_MISMATCH and the TN VED column outside the matcher: texts, filters,
// report order, API, the row drawer's facts and signals.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FindingType } from '@prisma/client';
import { evidenceFor, type MatchEvidence } from '@tasnivo/core/match/evidence';
import { dict } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { typeLabels } from '@tasnivo/i18n/type-labels';
import { CheckItemSchema, checkResultOut } from './api/check.js';
import { openApiSpec } from './api/openapi.js';
import { findingOut } from './api/serialize.js';
import { decisionMode, SUGGESTING_TYPES } from './finding-kinds.js';
import { reasonFacts } from './row-detail-parts.js';
import { rowSignals } from './row-signals.js';
import { FINDING_TYPES } from './workspace-filter.js';

describe('TNVED_MISMATCH as a finding type', () => {
  it('is a database enum value, a workspace filter, and a suggesting check', () => {
    assert.ok(Object.values(FindingType).includes('TNVED_MISMATCH'));
    assert.ok(FINDING_TYPES.includes('TNVED_MISMATCH'));
    assert.ok(SUGGESTING_TYPES.has('TNVED_MISMATCH'));
    assert.equal(decisionMode({ type: 'TNVED_MISMATCH', suggestedMxik: '07304001001000000', rerankNone: false, currentLive: true }), 'suggest');
  });

  it('has its texts in both languages', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const t = dict(locale);
      const ta = appDict(locale);
      assert.ok(t.typeTnvedMismatch.length > 0, locale);
      assert.equal(typeLabels(t)['TNVED_MISMATCH'], t.typeTnvedMismatch);
      assert.ok(ta.wsX.explain['TNVED_MISMATCH'], locale);
      assert.match(ta.wsX.reason.tnved('7304390000', '7304', '7306'), /7304390000.*7304.*7306/);
      assert.ok(ta.wsX.reason.tnvedNone.length > 0, locale);
      assert.ok(ta.importX.fields.tnved.length > 0, locale);
      assert.match(ta.importX.diag.badTnved(3), /3/);
      assert.match(ta.importX.diag.tnvedZero(2), /2/);
      for (const text of [ta.matchX.tnvedIn('7306'), ta.matchX.tnvedOutside('7306'), ta.matchX.tnvedFallback('7306'), ta.matchX.tnvedExistingOutside('7306')]) {
        assert.match(text, /7306/);
      }
    }
    assert.notEqual(dict('uz').typeTnvedMismatch, dict('ru').typeTnvedMismatch);
    assert.match(dict('uz').typeTnvedMismatch, /TIF TN/);
    assert.match(dict('ru').typeTnvedMismatch, /ТН ВЭД/);
  });
});

describe('TNVED_MISMATCH in the API', () => {
  it('passes through as its own type, never as OTHER', () => {
    const out = findingOut({
      id: 'f1', type: 'TNVED_MISMATCH', severity: 'medium', suggestedMxik: '07304001001000000', confidence: 0.6, reason: 'r',
      decision: 'pending', chosenMxik: null, decisionSource: null, restrictedFrom: null,
      item: { rowIndex: 0, rawName: 'Truba 57', barcode: null, unit: 'm', existingMxik: '07306001001000000' },
    });
    assert.equal(out.type, 'TNVED_MISMATCH');
    const check = checkResultOut('Truba 57', { markingRequired: false, findings: [{ type: 'TNVED_MISMATCH', severity: 'medium', suggestedMxik: null, confidence: null, reason: 'r', alternatives: [] }] });
    assert.equal(check.findings[0]?.type, 'TNVED_MISMATCH');
  });

  it('takes an optional tnved on a check item; older bodies stay valid', () => {
    assert.equal(CheckItemSchema.parse({ name: 'Truba 57', tnved: ' 7304390000 ' }).tnved, '7304390000');
    assert.equal(CheckItemSchema.parse({ name: 'Truba 57' }).tnved, undefined);
    assert.equal(CheckItemSchema.safeParse({ name: 'Truba 57', tnved: 'x'.repeat(33) }).success, false);
  });

  it('documents the field and the type in the OpenAPI document', () => {
    const spec = openApiSpec('http://api.example.test') as unknown as {
      components: { schemas: Record<string, { properties: Record<string, { description?: string; enum?: string[] }> }> };
    };
    const item = spec.components.schemas['CheckItem'];
    assert.match(item?.properties['tnved']?.description ?? '', /TNVED_MISMATCH/);
    assert.ok(spec.components.schemas['CheckFinding']?.properties['type']?.enum?.includes('TNVED_MISMATCH'));
  });
});

describe('the row drawer for a TN VED row', () => {
  const base = { severity: 'medium', reason: 'r', wasRetired: false, snapshotId: null, unit: 'm', codeUnits: [] };

  it('states the row\'s TN VED, its heading and the code\'s heading for TNVED_MISMATCH only', () => {
    const facts = reasonFacts({ ...base, type: 'TNVED_MISMATCH', existingMxik: '07306001001000000', tnved: '7304390000' });
    assert.deepEqual(facts.tnved, { code: '7304390000', heading: '7304', codeHeading: '7306' });
    assert.equal(reasonFacts({ ...base, type: 'MISMATCH', existingMxik: '07306001001000000', tnved: '7304390000' }).tnved, null);
    assert.equal(reasonFacts({ ...base, type: 'TNVED_MISMATCH', existingMxik: '07306001001000000', tnved: null }).tnved, null);
  });

  it('shows where the code came from, and warns when retrieval left the heading', () => {
    const ta = appDict('uz');
    const evidence = (extra: Partial<MatchEvidence>): MatchEvidence => ({
      ...evidenceFor({ stage: 'fusion', productName: 'truba', rowUnit: null, candidate: { nameUz: 'Truba', nameRu: 'Труба', unitBinding: 'none', unitCanonical: [] } }),
      ...extra,
    });
    const tnvedLines = (e: MatchEvidence) => rowSignals({ evidence: e, confidence: 0.6, rowUnit: null, codeUnit: null }, ta)
      .filter((s) => s.label === ta.matchX.tnvedLabel);
    assert.deepEqual(tnvedLines(evidence({ tnvedHeading: '7304' })).map((s) => [s.text, s.tone]), [[ta.matchX.tnvedIn('7304'), 'good']]);
    assert.deepEqual(
      tnvedLines(evidence({ tnvedHeading: '7304', tnvedOutside: true, tnvedFallback: true, tnvedExistingOutside: true })).map((s) => s.tone),
      ['warn', 'bad', 'warn'],
    );
    assert.deepEqual(tnvedLines(evidence({})), []);
  });
});
