import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { checkLexicon, EMPTY_LEXICON, installedLexicon, installLexicon, INVARIANTS, synonymProblems, unitAliasProblems, type Lexicon } from './lexicon.js';
import { normalizeName } from './index.js';
import { applySynonyms, synonymExtensionSize } from './synonyms.js';
import { resolveUnit } from './units.js';

const query = (name: string): string => normalizeName(name).queryKey;

/** A harmless entry: a seller word no file entry knows, mapped to a term no invariant row contains. */
const GLASS_WOOL = { forms: ['стекловата', 'steklovata'], term: 'стеклянная вата' } as const;

describe('installLexicon', () => {
  afterEach(() => installLexicon(EMPTY_LEXICON));

  it('with nothing installed the file tables alone apply', () => {
    assert.equal(synonymExtensionSize(), 0);
    assert.deepEqual(applySynonyms(query('Стекловата 50мм')).applied, []);
    assert.equal(resolveUnit('qop'), null);
  });

  it('merges learned synonyms after the file table and learned unit aliases over it', () => {
    installLexicon({ synonyms: [GLASS_WOOL], unitAliases: [{ alias: 'qop', target: 'dona' }] });
    assert.equal(synonymExtensionSize(), 1);
    const r = applySynonyms(query('Стекловата 50мм'));
    assert.deepEqual(r.applied, ['стекловата → стеклянная вата']);
    assert.match(r.text, /steklovata steklyannaya vata/);
    assert.equal(resolveUnit('qop')?.id, 1);
    // The file entries still fire as before.
    assert.match(applySynonyms(query('Арматура 12')).text, /prokat armaturniy/);
    assert.equal(resolveUnit('kg')?.id, 5);
  });

  it('EMPTY_LEXICON takes everything back', () => {
    installLexicon({ synonyms: [GLASS_WOOL], unitAliases: [{ alias: 'qop', target: 'dona' }] });
    installLexicon(EMPTY_LEXICON);
    assert.deepEqual(applySynonyms(query('Стекловата 50мм')).applied, []);
    assert.equal(resolveUnit('qop'), null);
    assert.equal(installedLexicon(), EMPTY_LEXICON);
  });
});

describe('checkLexicon', () => {
  afterEach(() => installLexicon(EMPTY_LEXICON));

  it('every invariant holds on the file tables alone', () => {
    const failures = INVARIANTS.map((i) => [i.name, i.check()] as const).filter(([, f]) => f !== null);
    assert.deepEqual(failures, []);
    assert.deepEqual(checkLexicon(EMPTY_LEXICON), { ok: true, problems: [] });
  });

  it('accepts a harmless entry and leaves the installed lexicon as it was', () => {
    const current: Lexicon = { synonyms: [], unitAliases: [{ alias: 'qop', target: 'dona' }] };
    installLexicon(current);
    const result = checkLexicon({ synonyms: [GLASS_WOOL], unitAliases: [{ alias: 'qop', target: 'dona' }, { alias: 'quti', target: 'dona' }] });
    assert.deepEqual(result, { ok: true, problems: [] });
    assert.equal(installedLexicon(), current, 'the trial table is not left installed');
    assert.equal(resolveUnit('quti'), null);
    assert.equal(resolveUnit('qop')?.id, 1);
  });

  it('refuses an entry that changes what an invariant row retrieves', () => {
    // "лист" fires on "Лист г/к …", which must search unchanged.
    const result = checkLexicon({ synonyms: [{ forms: ['лист'], term: 'прокат листовой', replace: true }], unitAliases: [] });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('a name without a synonym is unchanged:')), result.problems.join('\n'));
    assert.equal(installedLexicon(), EMPTY_LEXICON);
    assert.deepEqual(applySynonyms(query('Лист г/к 2,0х1250х2500')).applied, [], 'the refused entry did not stay installed');
  });

  it('refuses a unit alias that redefines a unit the tests pin', () => {
    const result = checkLexicon({ synonyms: [], unitAliases: [{ alias: 'kg', target: 'gramm' }] });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.startsWith('kilogram from four notations:')), result.problems.join('\n'));
    assert.equal(resolveUnit('kg')?.id, 5);
  });

  it('refuses malformed entries before trying them', () => {
    assert.deepEqual(synonymProblems({ forms: [''], term: 'abc' }), ['forms: at least one form that folds to a word is needed', 'forms: an empty form']);
    assert.deepEqual(synonymProblems({ forms: ['abc'], term: '---' }), ['term: folds to nothing']);
    assert.deepEqual(synonymProblems({ forms: ['abc'], term: 'def', kind: 'qualifier' }), ['kind: a qualifier entry needs a group']);
    assert.deepEqual(synonymProblems({ forms: ['abc'], term: 'def', group: 'nope' as 'catering' }), ['group: unknown "nope"']);
    assert.deepEqual(unitAliasProblems({ alias: 'qop', target: 'no such unit' }), ['target: "no such unit" is not an official unit']);
    assert.deepEqual(unitAliasProblems({ alias: 'qop', target: 'kilogramm' }), []);
    const result = checkLexicon({ synonyms: [{ forms: ['abc'], term: '---' }], unitAliases: [{ alias: ' ', target: 'dona' }] });
    assert.deepEqual(result, { ok: false, problems: ['synonym 1 (abc): term: folds to nothing', 'unit alias 1 ( ): alias: empty'] });
  });
});
