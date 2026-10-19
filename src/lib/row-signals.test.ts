import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evidenceFor, vetoEvidence, type MatchEvidence } from '../core/match/evidence.js';
import { appDict } from './i18n-app.js';
import { rowSignals } from './row-signals.js';

const uz = appDict('uz');
const ru = appDict('ru');
const CANDIDATE = { nameUz: 'Guruch oq', nameRu: 'Рис', unitBinding: 'none' as const, unitCanonical: [] };

function evidence(overrides: Partial<MatchEvidence> = {}): MatchEvidence {
  return { ...evidenceFor({ stage: 'fusion', productName: 'guruch oq', rowUnit: null, candidate: CANDIDATE }), ...overrides };
}

const signals = (e: MatchEvidence | null, ta = uz) => rowSignals({ evidence: e, confidence: 0.8, rowUnit: null, codeUnit: null }, ta);

describe('rowSignals: dictionary', () => {
  it('counts confirmations, never raw uses', () => {
    const s = signals(evidence({ stage: 'dictionary', dictionaryUses: 40, dictionaryConfirmations: 2 }));
    assert.equal(s[0]?.text, uz.msg.signals.dictionary(2));
    assert.ok(!s.some((x) => x.text.includes('40')));
  });

  it('says plainly when the entry was only ever bulk-accepted', () => {
    const s = signals(evidence({ stage: 'dictionary', dictionaryUses: 12, dictionaryConfirmations: 0 }));
    assert.equal(s[0]?.text, uz.matchX.dictionary.bulkOnly);
    assert.equal(s[0]?.tone, 'warn');
  });

  it('claims no count for evidence stored before confirmations existed', () => {
    const s = signals(evidence({ stage: 'dictionary', dictionaryUses: 7 }));
    assert.equal(s[0]?.text, uz.matchX.dictionary.legacy);
  });

  it('flags a dictionary entry that disagrees with the barcode', () => {
    const s = signals(evidence({ stage: 'barcode', barcode: true, dictionaryConflict: '01901001003000000' }));
    assert.ok(s.some((x) => x.text === uz.matchX.dictionary.conflict('01901001003000000') && x.tone === 'warn'));
  });
});

describe('rowSignals: AI disclosure', () => {
  it('labels a model-written reason as AI analysis, with the check-it note', () => {
    const s = signals(evidence({ stage: 'rerank', rerankReason: 'Brend nomi mos keladi.' }));
    const ai = s.find((x) => x.source === 'ai');
    assert.equal(ai?.label, uz.matchX.ai.label);
    assert.equal(ai?.text, 'Brend nomi mos keladi.');
    assert.equal(ai?.note, uz.matchX.ai.note);
    assert.equal(signals(evidence({ stage: 'rerank', rerankReason: 'x' }), ru).find((x) => x.source === 'ai')?.label, 'Анализ ИИ');
  });

  it('shows a stored veto as an AI verdict, without name or unit lines about a code that does not exist', () => {
    const s = signals(vetoEvidence());
    assert.deepEqual(s.map((x) => x.label), [uz.matchX.ai.label]);
    assert.equal(s[0]?.text, uz.msg.signals.rerankNone);
    assert.equal(s[0]?.tone, 'bad');
  });
});

describe('rowSignals: rules', () => {
  it('turns stored rule keys into translated signals', () => {
    const s = signals(evidence({ rules: ['baseCodePreferred', 'identifyingUnmarked'] }));
    const rules = s.filter((x) => x.label === uz.matchX.rulesLabel);
    assert.deepEqual(rules.map((x) => x.text), [uz.matchX.rules.baseCodePreferred, uz.matchX.rules.identifyingUnmarked]);
    assert.deepEqual(rules.map((x) => x.tone), ['good', 'warn']);
  });

  it('does not repeat a unit conflict the unit line already shows', () => {
    const s = signals(evidence({ unit: 'conflict', rules: ['strictUnitConflict'] }));
    assert.equal(s.filter((x) => x.label === uz.matchX.rulesLabel).length, 0);
    assert.equal(s.filter((x) => x.label === uz.msg.signals.unitLabel).length, 1);
  });
});

describe('rowSignals: without evidence', () => {
  it('shows the score as a score', () => {
    const s = rowSignals({ evidence: null, confidence: 0.81, rowUnit: null, codeUnit: null }, uz);
    assert.deepEqual(s, [{ label: uz.msg.signals.scoreLabel, text: uz.msg.signals.score(81), tone: 'neutral' }]);
    assert.deepEqual(rowSignals({ evidence: null, confidence: null, rowUnit: null, codeUnit: null }, uz), []);
  });
});
