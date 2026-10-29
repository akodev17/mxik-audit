// The learned lexicon (docs/MATCHING_V2_PLAN.md §11): what organisations confirmed, aggregated
// into global alias candidates; the synonym entries and unit aliases a platform admin keeps in
// the database; and the loader that merges the active rows with the hand-written tables.
//
// Learning: learn() in dictionary.ts calls recordAliasConfirmations() for individual and group
// decisions only (confirms()), so bulk accepts never reach learned_alias. Candidates: a
// (normalised name, code) pair at least ALIAS_MIN_ORGS distinct organisations confirmed. Nothing
// is active until an admin approves it; approved aliases, synonyms and unit aliases are read by
// applyLexicon() at the start of an audit (and by the bench, the eval and lexicon:check).
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ALIAS_MIN_ORGS, aliasKey, aliasLookup, type AliasLookup } from '@tasnivo/core/match/alias';
import { normalizeName } from '@tasnivo/core/normalize/index';
import {
  checkLexicon, EMPTY_LEXICON, installLexicon, type Lexicon, type LexiconCheck, type Synonym, type UnitAlias,
} from '@tasnivo/core/normalize/lexicon';
import { SYNONYM_GROUPS, SYNONYM_KINDS, SYNONYMS, type SynonymGroup, type SynonymKind } from '@tasnivo/core/normalize/synonyms';
import { UNIT_ALIAS_COUNT } from '@tasnivo/core/normalize/units';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { codeDetails } from './code-details.js';
import { confirms, type Learnable, type LearnSource } from './dictionary.js';

export const LEXICON_KINDS = ['synonym', 'unit', 'alias'] as const;
export type LexiconKind = (typeof LEXICON_KINDS)[number];

export const ENTRY_STATUSES = ['active', 'disabled', 'rejected'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** A synonyms.ts entry as JSON (readonly arrays dropped, so it round-trips through zod and Prisma). */
export type SynonymPayload = { forms: string[]; term: string; replace?: boolean; unless?: string[]; group?: SynonymGroup; kind?: SynonymKind };
export type UnitPayload = { alias: string; target: string };
export type AliasPayload = { key: string; code: string; label: string };
export type EntryPayload = SynonymPayload | UnitPayload | AliasPayload;

export type LexiconEntryRow = {
  id: string;
  kind: 'synonym' | 'unit';
  status: 'active' | 'disabled';
  key: string;
  payload: SynonymPayload | UnitPayload;
  note: string | null;
  updatedAt: string;
};

export type AliasCandidate = {
  /** The normalised name (match/alias.ts aliasKey). */
  key: string;
  code: string;
  codeName: string | null;
  orgs: number;
  confirmations: number;
  /** Product names as organisations wrote them, a few. */
  examples: string[];
  /** candidate until an admin decides; the lexicon_entry's status afterwards. */
  status: 'candidate' | EntryStatus;
  entryId: string | null;
};

export type LexiconPage = {
  synonyms: LexiconEntryRow[];
  units: LexiconEntryRow[];
  aliases: AliasCandidate[];
  /** The hand-written tables' sizes, for the page's note. */
  file: { synonyms: number; units: number };
};

// ------------------------------------------------------------------ learning

/**
 * Counts this org's confirmation of `code` for each item's normalised name.
 * Only a person's individual or group decision counts (dictionary.ts
 * confirms()); anything else is ignored here, so bulk accepts never add up to
 * a candidate. A different code for the same name is a row of its own: the
 * aggregation decides which code organisations agree on.
 */
export async function recordAliasConfirmations(orgId: string, items: readonly Learnable[], source: LearnSource | undefined): Promise<void> {
  if (!confirms(source)) return;
  const byKey = new Map<string, { key: string; label: string; code: string }>();
  for (const item of items) {
    const normalized = normalizeName(item.rawName);
    const key = normalized.sortedKey;
    if (!key || !/^\d{17}$/.test(item.code)) continue;
    byKey.set(`${key}|${item.code}`, { key, label: normalized.display.slice(0, 200), code: item.code });
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return;
  await db.$executeRaw`
    INSERT INTO learned_alias (id, "orgId", key, label, code, confirmations, "createdAt", "updatedAt")
    SELECT gen, ${orgId}, k, lb, cd, 1, now(), now()
    FROM unnest(${rows.map(() => randomUUID())}::text[], ${rows.map((r) => r.key)}::text[], ${rows.map((r) => r.label)}::text[], ${rows.map((r) => r.code)}::text[])
      AS t(gen, k, lb, cd)
    ON CONFLICT ("orgId", key, code) DO UPDATE SET
      confirmations = learned_alias.confirmations + 1, label = EXCLUDED.label, "updatedAt" = now()`;
}

/** Same, but a failure never blocks the decision it follows. */
export async function recordAliasConfirmationsQuietly(orgId: string, items: readonly Learnable[], source: LearnSource | undefined): Promise<void> {
  try {
    await recordAliasConfirmations(orgId, items, source);
  } catch (error) {
    console.warn(`[lexicon] alias confirmation not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------- candidates

type Aggregate = { key: string; code: string; orgs: number; confirmations: number; labels: string[] };

/** (name, code) pairs at least ALIAS_MIN_ORGS organisations confirmed, most agreed on first. */
async function aggregates(limit = 500): Promise<Aggregate[]> {
  const rows = await db.$queryRaw<{ key: string; code: string; orgs: number; confirmations: number; labels: string[] }[]>`
    SELECT key, code, count(DISTINCT "orgId")::int AS orgs, sum(confirmations)::int AS confirmations,
           (array_agg(DISTINCT label))[1:3] AS labels
    FROM learned_alias
    GROUP BY key, code
    HAVING count(DISTINCT "orgId") >= ${ALIAS_MIN_ORGS}
    ORDER BY orgs DESC, confirmations DESC, key, code
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, labels: r.labels ?? [] }));
}

const aliasEntryKey = (key: string, code: string): string => `${key}|${code}`;

/** The candidates with their decision (if any) and the code's name, for the admin page. */
export async function aliasCandidates(locale: Locale = 'uz'): Promise<AliasCandidate[]> {
  const agg = await aggregates();
  const decided = agg.length === 0 ? [] : await db.lexiconEntry.findMany({
    where: { kind: 'alias', key: { in: agg.map((a) => aliasEntryKey(a.key, a.code)) } },
    select: { id: true, key: true, status: true },
  });
  const byKey = new Map(decided.map((d) => [d.key, d]));
  const details = await codeDetails(agg.map((a) => a.code), locale);
  return agg.map((a) => {
    const entry = byKey.get(aliasEntryKey(a.key, a.code));
    return {
      key: a.key, code: a.code, codeName: details.get(a.code)?.name ?? null, orgs: a.orgs, confirmations: a.confirmations,
      examples: a.labels, status: entry ? readStatus(entry.status) : 'candidate', entryId: entry?.id ?? null,
    };
  });
}

function readStatus(value: string): EntryStatus {
  return (ENTRY_STATUSES as readonly string[]).includes(value) ? (value as EntryStatus) : 'disabled';
}

// ------------------------------------------------------------------- loading

export type LoadedLexicon = {
  lexicon: Lexicon;
  aliases: AliasLookup & { size: number };
  counts: { synonyms: number; units: number; aliases: number };
};

const EMPTY_LOADED: LoadedLexicon = { lexicon: EMPTY_LEXICON, aliases: aliasLookup([]), counts: { synonyms: 0, units: 0, aliases: 0 } };

/** The active rows as the matcher consumes them. Malformed payloads are skipped, never thrown. */
export async function loadLexicon(): Promise<LoadedLexicon> {
  const rows = await db.lexiconEntry.findMany({ where: { status: 'active' }, select: { kind: true, payload: true }, orderBy: { createdAt: 'asc' } });
  const synonyms: Synonym[] = [];
  const unitAliases: UnitAlias[] = [];
  const aliases: { key: string; code: string; orgs: number; confirmations: number }[] = [];
  for (const row of rows) {
    if (row.kind === 'synonym') {
      const p = readSynonymPayload(row.payload);
      if (p) synonyms.push(toSynonym(p));
    } else if (row.kind === 'unit') {
      const p = readUnitPayload(row.payload);
      if (p) unitAliases.push(p);
    } else if (row.kind === 'alias') {
      const p = readAliasPayload(row.payload);
      if (p) aliases.push({ key: p.key, code: p.code, orgs: 0, confirmations: 0 });
    }
  }
  // The counts shown on the evidence line are live: what organisations stand behind the alias today.
  if (aliases.length > 0) {
    const live = await db.$queryRaw<{ key: string; code: string; orgs: number; confirmations: number }[]>`
      SELECT key, code, count(DISTINCT "orgId")::int AS orgs, sum(confirmations)::int AS confirmations
      FROM learned_alias WHERE key = ANY(${aliases.map((a) => a.key)}::text[]) GROUP BY key, code`;
    const counts = new Map(live.map((l) => [aliasEntryKey(l.key, l.code), l]));
    for (const a of aliases) {
      const c = counts.get(aliasEntryKey(a.key, a.code));
      // An approved alias whose confirmations were purged still counts the admin's approval as one organisation.
      a.orgs = Math.max(1, c?.orgs ?? 0);
      a.confirmations = c?.confirmations ?? 0;
    }
  }
  return { lexicon: { synonyms, unitAliases }, aliases: aliasLookup(aliases), counts: { synonyms: synonyms.length, units: unitAliases.length, aliases: aliases.length } };
}

const CACHE_MS = 60_000;
let cached: { at: number; value: LoadedLexicon } | null = null;

/**
 * Loads the lexicon (cached a minute per process), installs it for the
 * normaliser and returns the alias lookup for the pipeline. A database
 * failure leaves the file tables alone: matching never depends on this read.
 */
export async function applyLexicon(options: { fresh?: boolean } = {}): Promise<LoadedLexicon> {
  const now = Date.now();
  if (!options.fresh && cached && now - cached.at < CACHE_MS) return cached.value;
  let loaded: LoadedLexicon;
  try {
    loaded = await loadLexicon();
  } catch (error) {
    console.warn(`[lexicon] not loaded, file tables only: ${error instanceof Error ? error.message : String(error)}`);
    loaded = EMPTY_LOADED;
  }
  installLexicon(loaded.lexicon);
  cached = { at: now, value: loaded };
  return loaded;
}

/** Forgets the cached copy, so the next audit reads the table again (after an admin save). */
export function forgetLexicon(): void {
  cached = null;
}

// ------------------------------------------------------------------ payloads

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v) : null);

export function readSynonymPayload(value: unknown): SynonymPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const forms = strings(v['forms'])?.map((f) => f.trim()).filter(Boolean) ?? [];
  const term = str(v['term'])?.trim() ?? '';
  if (forms.length === 0 || !term) return null;
  const unless = strings(v['unless'])?.map((u) => u.trim()).filter(Boolean);
  const group = str(v['group']);
  const kind = str(v['kind']);
  if (group !== null && !(SYNONYM_GROUPS as readonly string[]).includes(group)) return null;
  if (kind !== null && !(SYNONYM_KINDS as readonly string[]).includes(kind)) return null;
  return {
    forms, term,
    ...(v['replace'] === true ? { replace: true } : {}),
    ...(unless && unless.length > 0 ? { unless } : {}),
    ...(group ? { group: group as SynonymGroup } : {}),
    ...(kind ? { kind: kind as SynonymKind } : {}),
  };
}

export function readUnitPayload(value: unknown): UnitPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const alias = str(v['alias'])?.trim() ?? '';
  const target = str(v['target'])?.trim() ?? '';
  return alias && target ? { alias, target } : null;
}

export function readAliasPayload(value: unknown): AliasPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const key = str(v['key'])?.trim() ?? '';
  const code = str(v['code'])?.trim() ?? '';
  if (!key || !/^\d{17}$/.test(code)) return null;
  return { key, code, label: str(v['label']) ?? key };
}

/** A synonyms.ts entry from a payload (the same shape; `replace` must be the literal true). */
function toSynonym(p: SynonymPayload): Synonym {
  return {
    forms: p.forms, term: p.term,
    ...(p.replace ? { replace: true as const } : {}),
    ...(p.unless ? { unless: p.unless } : {}),
    ...(p.group ? { group: p.group } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
  };
}

/** The unique key of an entry: the folded forms of a synonym, the folded alias of a unit. */
export function entryKeyOf(kind: 'synonym' | 'unit', payload: SynonymPayload | UnitPayload): string {
  if (kind === 'synonym') return (payload as SynonymPayload).forms.map((f) => normalizeName(f).matchKey).filter(Boolean).join('|');
  return normalizeName((payload as UnitPayload).alias).matchKey;
}

// --------------------------------------------------------------------- admin

export type Admin = { userId: string; orgId: string };

export type SaveResult = { ok: true; id: string } | { ok: false; problems: string[] };

function toRow(e: { id: string; kind: string; status: string; key: string; payload: Prisma.JsonValue; note: string | null; updatedAt: Date }): LexiconEntryRow | null {
  const payload = e.kind === 'synonym' ? readSynonymPayload(e.payload) : e.kind === 'unit' ? readUnitPayload(e.payload) : null;
  if (!payload || (e.kind !== 'synonym' && e.kind !== 'unit')) return null;
  return { id: e.id, kind: e.kind, status: e.status === 'active' ? 'active' : 'disabled', key: e.key, payload, note: e.note, updatedAt: e.updatedAt.toISOString() };
}

/** Everything /admin/lexicon shows. */
export async function lexiconPage(locale: Locale): Promise<LexiconPage> {
  const [entries, aliases] = await Promise.all([
    db.lexiconEntry.findMany({ where: { kind: { in: ['synonym', 'unit'] } }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] }),
    aliasCandidates(locale),
  ]);
  const rows = entries.map(toRow).filter((r): r is LexiconEntryRow => r !== null);
  return {
    synonyms: rows.filter((r) => r.kind === 'synonym'),
    units: rows.filter((r) => r.kind === 'unit'),
    aliases,
    file: { synonyms: SYNONYMS.length, units: UNIT_ALIAS_COUNT },
  };
}

/** The lexicon the active rows make, with one entry replaced (or added when `id` is null) or left out. */
async function lexiconWith(change: { id: string | null; kind: 'synonym' | 'unit'; payload: SynonymPayload | UnitPayload } | { id: string; remove: true }): Promise<Lexicon> {
  const rows = await db.lexiconEntry.findMany({ where: { status: 'active', kind: { in: ['synonym', 'unit'] } }, select: { id: true, kind: true, payload: true }, orderBy: { createdAt: 'asc' } });
  const synonyms: Synonym[] = [];
  const unitAliases: UnitAlias[] = [];
  for (const row of rows) {
    if (row.id === change.id) continue;
    if (row.kind === 'synonym') { const p = readSynonymPayload(row.payload); if (p) synonyms.push(toSynonym(p)); }
    if (row.kind === 'unit') { const p = readUnitPayload(row.payload); if (p) unitAliases.push(p); }
  }
  if (!('remove' in change)) {
    if (change.kind === 'synonym') synonyms.push(toSynonym(change.payload as SynonymPayload));
    else unitAliases.push(change.payload as UnitPayload);
  }
  return { synonyms, unitAliases };
}

/** The check an admin save runs: the active lexicon with the change applied must keep the normaliser's invariants. */
export async function checkChange(change: Parameters<typeof lexiconWith>[0]): Promise<LexiconCheck> {
  return checkLexicon(await lexiconWith(change));
}

async function audit(admin: Admin, action: string, targetId: string, payload: Prisma.InputJsonObject): Promise<void> {
  await db.auditEvent.create({ data: { orgId: admin.orgId, actorId: admin.userId, action, targetId, payload } });
}

/** Adds a synonym or unit alias as an active entry; refused with the problems when the check fails or the key exists. */
export async function createEntry(admin: Admin, input: { kind: 'synonym' | 'unit'; payload: unknown; note?: string | null }): Promise<SaveResult> {
  const payload = input.kind === 'synonym' ? readSynonymPayload(input.payload) : readUnitPayload(input.payload);
  if (!payload) return { ok: false, problems: ['payload: malformed'] };
  const key = entryKeyOf(input.kind, payload);
  if (!key) return { ok: false, problems: ['forms: fold to nothing'] };
  if (await db.lexiconEntry.findUnique({ where: { kind_key: { kind: input.kind, key } }, select: { id: true } })) return { ok: false, problems: ['duplicate'] };
  const check = await checkChange({ id: null, kind: input.kind, payload });
  if (!check.ok) return { ok: false, problems: check.problems };
  const row = await db.lexiconEntry.create({
    data: { kind: input.kind, status: 'active', key, payload: payload, note: input.note?.trim() || null, createdBy: admin.userId, updatedBy: admin.userId },
    select: { id: true },
  });
  await audit(admin, 'lexicon.created', row.id, { kind: input.kind, key, payload: payload });
  forgetLexicon();
  return { ok: true, id: row.id };
}

export type EntryPatch = { payload?: unknown; note?: string | null; status?: 'active' | 'disabled' };

/** Edits, disables or re-enables a synonym or unit entry; an edit or re-enable is checked like a new entry. */
export async function updateEntry(admin: Admin, id: string, patch: EntryPatch): Promise<SaveResult | { ok: false; notFound: true }> {
  const current = await db.lexiconEntry.findUnique({ where: { id } });
  if (!current || (current.kind !== 'synonym' && current.kind !== 'unit')) return { ok: false, notFound: true };
  const kind = current.kind;
  const payload = patch.payload === undefined
    ? (kind === 'synonym' ? readSynonymPayload(current.payload) : readUnitPayload(current.payload))
    : (kind === 'synonym' ? readSynonymPayload(patch.payload) : readUnitPayload(patch.payload));
  if (!payload) return { ok: false, problems: ['payload: malformed'] };
  const status = patch.status ?? (current.status === 'active' ? 'active' : 'disabled');
  const key = entryKeyOf(kind, payload);
  if (!key) return { ok: false, problems: ['forms: fold to nothing'] };
  if (key !== current.key && await db.lexiconEntry.findUnique({ where: { kind_key: { kind, key } }, select: { id: true } })) return { ok: false, problems: ['duplicate'] };
  if (status === 'active') {
    const check = await checkChange({ id, kind, payload });
    if (!check.ok) return { ok: false, problems: check.problems };
  }
  await db.lexiconEntry.update({
    where: { id },
    data: {
      key, status, payload: payload, updatedBy: admin.userId, updatedAt: new Date(),
      ...(patch.note === undefined ? {} : { note: patch.note?.trim() || null }),
    },
  });
  await audit(admin, 'lexicon.updated', id, { kind, key, status, payload: payload, previousStatus: current.status, previousPayload: current.payload });
  forgetLexicon();
  return { ok: true, id };
}

export type AliasDecision = 'approve' | 'reject';

/**
 * Approves or rejects a global alias candidate. Approval only takes a name
 * organisations actually confirmed (the aggregation is the source of truth) for
 * a live classifier code; a rejected name stays listed as rejected so it is not
 * asked about again. Either decision may be changed later.
 */
export async function decideAlias(admin: Admin, input: { key: string; code: string; decision: AliasDecision }): Promise<SaveResult> {
  const key = input.key.trim();
  const code = input.code.trim();
  if (!key || !/^\d{17}$/.test(code)) return { ok: false, problems: ['key or code: malformed'] };
  const agg = await db.$queryRaw<{ orgs: number; label: string }[]>`
    SELECT count(DISTINCT "orgId")::int AS orgs, min(label) AS label FROM learned_alias WHERE key = ${key} AND code = ${code}`;
  const orgs = agg[0]?.orgs ?? 0;
  if (orgs < ALIAS_MIN_ORGS) return { ok: false, problems: [`not a candidate: ${orgs} organisation(s) confirmed it, ${ALIAS_MIN_ORGS} needed`] };
  if (input.decision === 'approve') {
    const live = await db.mxikCode.findFirst({ where: { code, retiredAt: null }, select: { code: true } });
    if (!live) return { ok: false, problems: ['code: not in the classifier'] };
  }
  const status: EntryStatus = input.decision === 'approve' ? 'active' : 'rejected';
  const payload: AliasPayload = { key, code, label: agg[0]?.label ?? key };
  const row = await db.lexiconEntry.upsert({
    where: { kind_key: { kind: 'alias', key: aliasEntryKey(key, code) } },
    create: { kind: 'alias', status, key: aliasEntryKey(key, code), payload, createdBy: admin.userId, updatedBy: admin.userId },
    update: { status, payload, updatedBy: admin.userId, updatedAt: new Date() },
    select: { id: true },
  });
  await audit(admin, `lexicon.alias_${input.decision === 'approve' ? 'approved' : 'rejected'}`, row.id, { key, code, orgs });
  forgetLexicon();
  return { ok: true, id: row.id };
}

/** The alias key of a product name, re-exported for callers that build test data. */
export { aliasKey };
