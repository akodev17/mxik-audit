// The learned lexicon: synonym entries and unit aliases that live in the
// database (admin page /admin/lexicon) and are merged with the hand-written
// tables at load time. The file tables stay the baseline: with nothing
// installed every function below is a no-op and the matcher behaves as before.
//
// Installing is a process-wide switch (synonyms.ts and units.ts consult one
// extension each), so the audit, the bench and the eval all read the same
// lexicon once the domain has loaded it. checkLexicon() is what an admin save
// runs: it compiles the entries, installs them for the length of a synchronous
// check, replays the normaliser's own invariants (the cases its unit tests
// pin), and restores whatever was installed before. Nothing async happens in
// between, so a concurrent audit never sees the trial table.
import { normalizeName } from './index.js';
import { applySynonyms, setSynonymExtension, SYNONYM_GROUPS, SYNONYM_KINDS, type Synonym, type SynonymGroup, type SynonymKind } from './synonyms.js';
import { isOfficialUnitForm, resolveUnit, setUnitAliasExtension, type UnitAlias } from './units.js';

export type { Synonym, SynonymGroup, SynonymKind, UnitAlias };

export type Lexicon = {
  synonyms: readonly Synonym[];
  unitAliases: readonly UnitAlias[];
};

export const EMPTY_LEXICON: Lexicon = { synonyms: [], unitAliases: [] };

let installed: Lexicon = EMPTY_LEXICON;

/** Merges the lexicon with the file tables for every later normalisation; EMPTY_LEXICON restores the files alone. */
export function installLexicon(lexicon: Lexicon): void {
  setSynonymExtension(lexicon.synonyms);
  setUnitAliasExtension(lexicon.unitAliases);
  installed = lexicon;
}

/** What is installed now (the file tables are not counted). */
export function installedLexicon(): Lexicon {
  return installed;
}

/** Problems with one synonym entry's shape, before it is tried: empty when it is well formed. */
export function synonymProblems(entry: Synonym): string[] {
  const problems: string[] = [];
  const forms = entry.forms.map((f) => normalizeName(f).matchKey).filter(Boolean);
  if (forms.length === 0) problems.push('forms: at least one form that folds to a word is needed');
  if (entry.forms.some((f) => f.trim() === '')) problems.push('forms: an empty form');
  if (!normalizeName(entry.term).matchKey) problems.push('term: folds to nothing');
  if (entry.group !== undefined && !SYNONYM_GROUPS.includes(entry.group)) problems.push(`group: unknown "${String(entry.group)}"`);
  if (entry.kind !== undefined && !SYNONYM_KINDS.includes(entry.kind)) problems.push(`kind: unknown "${String(entry.kind)}"`);
  if ((entry.kind === 'contextual' || entry.kind === 'qualifier') && !entry.group) problems.push(`kind: a ${entry.kind} entry needs a group`);
  for (const u of entry.unless ?? []) if (!normalizeName(u).matchKey) problems.push(`unless: "${u}" folds to nothing`);
  return problems;
}

/** Problems with one unit alias's shape: empty when its target is an official unit and the alias folds to something. */
export function unitAliasProblems(alias: UnitAlias): string[] {
  const problems: string[] = [];
  if (!alias.alias.trim()) problems.push('alias: empty');
  if (!isOfficialUnitForm(alias.target)) problems.push(`target: "${alias.target}" is not an official unit`);
  return problems;
}

/** One check of the normaliser the lexicon must not break; null when it holds, else what went wrong. */
export type Invariant = { name: string; check: () => string | null };

const query = (name: string): string => normalizeName(name).queryKey;
const expectText = (name: string, pattern: RegExp, row?: { unit?: string }): string | null => {
  const text = applySynonyms(query(name), row ? { name, ...row } : { name }).text;
  return pattern.test(text) ? null : `"${name}" searches as "${text}"`;
};
const expectUnit = (input: string, id: number): string | null => {
  const got = resolveUnit(input)?.id ?? null;
  return got === id ? null : `"${input}" resolves to ${got ?? 'nothing'}, expected unit ${id}`;
};
const expectNoSynonym = (name: string): string | null => {
  const applied = applySynonyms(query(name), { name }).applied;
  return applied.length === 0 ? null : `"${name}" fires ${applied.join('; ')}`;
};
const expectCatering = (name: string, unit: string | undefined, expected: boolean): string | null => {
  const groups = applySynonyms(query(name), { name, unit: unit ?? null }).groups;
  const got = groups.includes('catering');
  return got === expected ? null : `"${name}" is ${got ? '' : 'not '}read as catering`;
};

/**
 * The normaliser's invariants, the same cases synonyms.test.ts and
 * units.test.ts pin: a learned entry may add to the tables but may not change
 * what these rows retrieve or which unit these strings resolve to.
 */
export const INVARIANTS: readonly Invariant[] = [
  { name: 'rebar reads as the classifier names it', check: () => expectText('Арматура А500С ф12', /\bprokat armaturniy\b/) },
  { name: 'rebar: the ambiguous word is replaced', check: () => expectText('Armatura 14 mm', /^(?!.*\barmatura\b)/) },
  { name: 'pipe fittings keep their word', check: () => expectText('Арматура запорная', /^(?!.*prokat)/) },
  { name: 'angle steel adds the classifier wording', check: () => expectText('Уголок 50х50х5', /^ugolok ugloviye profili uglovaya stal$/) },
  { name: 'a PVC corner is left alone', check: () => expectNoSynonym('Уголок ПВХ белый 3м') },
  { name: 'mineral wool is replaced', check: () => expectText('Минвата Rockwool 50мм', /^mineralnaya vata rockwool$/) },
  { name: 'polypropylene is spelt out', check: () => expectText('Труба ПП PN20 25мм', /\bpolipropilenoviye\b/) },
  { name: 'a name without a synonym is unchanged', check: () => expectText('Лист г/к 2,0х1250х2500', new RegExp(`^${query('Лист г/к 2,0х1250х2500')}$`)) },
  { name: 'a dish is a cafe row', check: () => expectCatering('Palov 1 porsiya', 'porsiya', true) },
  { name: 'a seasoning for a dish is grocery', check: () => expectCatering('Palov uchun ziravor', undefined, false) },
  { name: 'tea in a shop is tea leaves', check: () => expectCatering('Choy qora 100 g', 'dona', false) },
  { name: 'kilogram from four notations', check: () => ['kilogramm', 'килограмм', 'kg', 'кг'].map((s) => expectUnit(s, 5)).find((p) => p !== null) ?? null },
  { name: 'pieces from its spellings', check: () => ['dona', 'дона', 'sht', 'шт', 'pcs', 'porsiya'].map((s) => expectUnit(s, 1)).find((p) => p !== null) ?? null },
  { name: 'either reading of ц', check: () => expectUnit('tsentner', 6) ?? expectUnit('sentner', 6) },
  { name: 'a leading quantity is stripped', check: () => expectUnit('500 gramm', resolveUnit('gramm')?.id ?? -1) },
  { name: 'fused unit and packaging strings', check: () => expectUnit('dona (paket) 500 gramm', 1) },
  { name: 'litre', check: () => expectUnit('л', resolveUnit('litr')?.id ?? -1) },
];

export type LexiconCheck = { ok: boolean; problems: string[] };

/**
 * Whether the lexicon can be installed: every entry well formed, and the
 * normaliser's invariants intact with it merged into the file tables. Leaves
 * the previously installed lexicon in place.
 */
export function checkLexicon(lexicon: Lexicon): LexiconCheck {
  const problems: string[] = [];
  lexicon.synonyms.forEach((s, i) => problems.push(...synonymProblems(s).map((p) => `synonym ${i + 1} (${s.forms[0] ?? ''}): ${p}`)));
  lexicon.unitAliases.forEach((u, i) => problems.push(...unitAliasProblems(u).map((p) => `unit alias ${i + 1} (${u.alias}): ${p}`)));
  if (problems.length > 0) return { ok: false, problems };
  const before = installed;
  try {
    installLexicon(lexicon);
    for (const invariant of INVARIANTS) {
      let failure: string | null;
      try {
        failure = invariant.check();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      if (failure !== null) problems.push(`${invariant.name}: ${failure}`);
    }
  } finally {
    installLexicon(before);
  }
  return { ok: problems.length === 0, problems };
}
