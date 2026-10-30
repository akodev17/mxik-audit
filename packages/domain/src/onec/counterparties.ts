// The org's counterparties: matching what a statement or an invoice names against them (ИНН →
// account → normalised name → alias, docs/TASNIVO_AI_PLAN_2026-10-23.md §4.1), recording the new
// ones, and loading a client's existing list from a 1C «Контрагенты» export before the first
// statement. Aliases are kept as normalised names (normalize.ts), the form matching compares.
import type { Prisma } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { uploadsOpen } from '../plan.js';
import { readGrid } from '../spreadsheet.js';
import { normalizeName } from './normalize.js';
import { checkRequisites, kindOf, type CounterpartyKind, type RequisiteError } from './requisites.js';

type CounterpartyRef = z.infer<typeof accounting.CounterpartyRef>;
type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;
type MatchBasis = MatchCandidate['basis'];

/** How sure each basis is. ИНН identifies a taxpayer; an account a taxpayer's bank account; names may collide. */
export const BASIS_CONFIDENCE: Partial<Record<MatchBasis, number>> = {
  onec_ref: 1, inn: 0.99, account: 0.95, name_exact: 0.9, name_normalized: 0.85, alias: 0.8,
};

/**
 * Which counterparties a call sees: `clientId` undefined = the whole org (any client), a string =
 * that client's, null = the org's own (no client).
 */
export type CounterpartyScope = { clientId?: string | null };

type Row = {
  id: string; name: string; normalizedName: string; inn: string | null; account: string | null; mfo: string | null; aliases: string[]; clientId: string | null;
  kind: string | null; branchCode: string | null; vatCode: string | null; onecRef: string | null;
};
const SELECT = { id: true, name: true, normalizedName: true, inn: true, account: true, mfo: true, aliases: true, clientId: true, kind: true, branchCode: true, vatCode: true, onecRef: true } as const;

/** A ref plus what a 1C «Контрагенты» list adds: the kind, the branch code (ИНН + код филиала, 3.0.62), the VAT code and the 1C code. */
/** A ref after matching: its counterparty and the match decision. */
export type Matched<T> = T & Pick<CounterpartyRef, 'counterpartyId' | 'match'>;

export type CounterpartyInput = CounterpartyRef & { kind?: CounterpartyKind | null; branchCode?: string | null; vatCode?: string | null; onecRef?: string | null };

function scopeWhere(orgId: string, scope: CounterpartyScope): Prisma.CounterpartyWhereInput {
  return scope.clientId === undefined ? { orgId } : { orgId, clientId: scope.clientId };
}

const candidate = (row: Row, basis: MatchBasis, confidence = BASIS_CONFIDENCE[basis] ?? 0.5): MatchCandidate =>
  ({ id: row.id, label: row.inn ? `${row.name} (${row.inn})` : row.name, confidence, basis });

/** A ref with nothing to match on (an acquiring line, a bank fee): the matcher cannot run. */
const blank = (ref: CounterpartyRef): boolean => !ref.inn && !ref.account && normalizeName(ref.name) === '';

/** A name or account match is only plausible when the ИНН does not contradict it. */
const innAgrees = (ref: CounterpartyRef, row: Row): boolean => !ref.inn || !row.inn || ref.inn === row.inn;

/** The decision for one ref against the rows the batch query found. Pure. */
export function decide(ref: CounterpartyInput, rows: readonly Row[]): NonNullable<CounterpartyRef['match']> {
  if (blank(ref)) return { status: 'unknown', chosen: null, candidates: [] };
  const norm = normalizeName(ref.name);
  const one = (found: Row[], basis: MatchBasis): NonNullable<CounterpartyRef['match']> | null => {
    if (found.length === 0) return null;
    const candidates = found.slice(0, 10).map((r) => candidate(r, basis === 'name_normalized' && r.name.trim().toLowerCase() === ref.name.trim().toLowerCase() ? 'name_exact' : basis));
    return found.length === 1
      ? { status: 'matched', chosen: candidates[0] ?? null, candidates }
      : { status: 'ambiguous', chosen: null, candidates };
  };
  if (ref.inn && ref.branchCode) {
    // 1C UZ (3.0.62) tells counterparties apart by ИНН + код филиала: another branch of a known ИНН is a new one,
    // even under the same name (onec §8.14).
    const branch = rows.filter((r) => r.inn === ref.inn && r.branchCode === ref.branchCode);
    // The one row of that ИНН with no branch known (made from a statement or an invoice), when no branch of it is known
    // either, is this branch, not a second counterparty that would make the ИНН ambiguous later (review 30 Oct, R-O9).
    const sameInn = rows.filter((r) => r.inn === ref.inn);
    const sole = branch.length === 0 && sameInn.length === 1 && !sameInn[0]?.branchCode ? sameInn : [];
    return one(branch, 'inn') ?? one(sole, 'inn') ?? { status: 'new', chosen: null, candidates: [] };
  }
  if (ref.inn) {
    const byInn = rows.filter((r) => r.inn === ref.inn);
    // Several rows with one ИНН (a branch per account): the account decides.
    const narrowed = byInn.length > 1 && ref.account ? byInn.filter((r) => r.account === ref.account) : byInn;
    const hit = one(narrowed.length > 0 ? narrowed : byInn, 'inn');
    if (hit) return hit;
  }
  if (ref.account) {
    const hit = one(rows.filter((r) => r.account === ref.account && innAgrees(ref, r)), 'account');
    if (hit) return hit;
  }
  if (norm) {
    const hit = one(rows.filter((r) => r.normalizedName === norm && innAgrees(ref, r)), 'name_normalized');
    if (hit) return hit;
    const alias = one(rows.filter((r) => r.aliases.includes(norm) && innAgrees(ref, r)), 'alias');
    if (alias) return alias;
  }
  return { status: 'new', chosen: null, candidates: [] };
}

async function candidatesFor(orgId: string, refs: readonly CounterpartyRef[], scope: CounterpartyScope): Promise<Row[]> {
  const inns = [...new Set(refs.flatMap((r) => (r.inn ? [r.inn] : [])))];
  const accounts = [...new Set(refs.flatMap((r) => (r.account ? [r.account] : [])))];
  const names = [...new Set(refs.map((r) => normalizeName(r.name)).filter(Boolean))];
  const or: Prisma.CounterpartyWhereInput[] = [];
  if (inns.length) or.push({ inn: { in: inns } });
  if (accounts.length) or.push({ account: { in: accounts } });
  if (names.length) or.push({ normalizedName: { in: names } }, { aliases: { hasSome: names } });
  if (or.length === 0) return [];
  return db.counterparty.findMany({ where: { ...scopeWhere(orgId, scope), OR: or }, select: SELECT, orderBy: { createdAt: 'asc' } });
}

/**
 * Matches each ref against the org's counterparties; fills `counterpartyId` (when one candidate is
 * certain) and `match`. A ref that already carries a counterparty of the org keeps it.
 */
export async function matchCounterparties<T extends CounterpartyInput>(orgId: string, refs: T[], scope: CounterpartyScope = {}): Promise<Matched<T>[]> {
  const rows = await candidatesFor(orgId, refs, scope);
  const kept = new Set((await db.counterparty.findMany({
    where: { orgId, id: { in: refs.flatMap((r) => (r.counterpartyId ? [r.counterpartyId] : [])) } }, select: { id: true },
  })).map((r) => r.id));
  return refs.map((ref) => {
    if (ref.counterpartyId && kept.has(ref.counterpartyId)) return ref;
    const match = decide(ref, rows);
    return { ...ref, counterpartyId: match.status === 'matched' ? match.chosen?.id ?? null : null, match };
  });
}

export type RecordOptions = CounterpartyScope & { source?: 'bank_statement' | 'didox' | 'onec_export' | 'manual' };

/**
 * Like matchCounterparties, then: a `new` ref with a name is created (once per ИНН / account /
 * name within the call), and a matched counterparty learns what it lacked (the ref's spelling as
 * an alias, a missing ИНН, account or МФО). Ambiguous and unknown refs are left for the reviewer.
 */
export async function recordCounterparties<T extends CounterpartyInput>(orgId: string, refs: T[], options: RecordOptions = {}): Promise<Matched<T>[]> {
  const matched = await matchCounterparties(orgId, refs, options);
  const created = new Map<string, MatchCandidate>();
  const learned = new Map<string, { aliases: Set<string>; inn?: string; account?: string; mfo?: string; kind?: string; vatCode?: string; onecRef?: string }>();
  const byId = new Map((await candidatesFor(orgId, matched, options)).map((r) => [r.id, r]));
  const out: Matched<T>[] = [];
  for (const ref of matched) {
    const norm = normalizeName(ref.name);
    if (ref.match?.status === 'new' && norm) {
      const key = ref.inn ? `inn:${ref.inn}:${ref.branchCode ?? ''}` : ref.account ? `acc:${ref.account}` : `name:${norm}`;
      let chosen = created.get(key);
      if (!chosen) {
        const row = await db.counterparty.create({
          data: {
            orgId, clientId: options.clientId ?? null, name: ref.name.trim(), normalizedName: norm, inn: ref.inn, account: ref.account, mfo: ref.mfo,
            kind: ref.kind ?? null, branchCode: ref.branchCode ?? null, vatCode: ref.vatCode ?? null, onecRef: ref.onecRef ?? null,
            aliases: [], source: options.source ?? 'manual',
          },
          select: SELECT,
        });
        chosen = { ...candidate(row, ref.inn ? 'inn' : ref.account ? 'account' : 'name_exact', 1), reason: 'created' };
        created.set(key, chosen);
      }
      out.push({ ...ref, counterpartyId: chosen.id, match: { status: 'new', chosen, candidates: [chosen] } });
      continue;
    }
    const row = ref.counterpartyId ? byId.get(ref.counterpartyId) : undefined;
    if (row && ref.match?.status === 'matched') {
      const learn = learned.get(row.id) ?? { aliases: new Set<string>() };
      if (norm && norm !== row.normalizedName && !row.aliases.includes(norm)) learn.aliases.add(norm);
      if (!row.inn && ref.inn) learn.inn = ref.inn;
      if (!row.account && ref.account) learn.account = ref.account;
      if (!row.mfo && ref.mfo) learn.mfo = ref.mfo;
      if (!row.kind && ref.kind) learn.kind = ref.kind;
      if (!row.vatCode && ref.vatCode) learn.vatCode = ref.vatCode;
      if (!row.onecRef && ref.onecRef) learn.onecRef = ref.onecRef;
      learned.set(row.id, learn);
    }
    out.push(ref);
  }
  for (const [id, learn] of learned) {
    const row = byId.get(id);
    if (!row || (learn.aliases.size === 0 && !learn.inn && !learn.account && !learn.mfo && !learn.kind && !learn.vatCode && !learn.onecRef)) continue;
    await db.counterparty.update({
      where: { id },
      data: {
        ...(learn.aliases.size > 0 ? { aliases: [...row.aliases, ...learn.aliases].slice(-50) } : {}),
        ...(learn.inn ? { inn: learn.inn } : {}), ...(learn.account ? { account: learn.account } : {}), ...(learn.mfo ? { mfo: learn.mfo } : {}),
        ...(learn.kind ? { kind: learn.kind } : {}), ...(learn.vatCode ? { vatCode: learn.vatCode } : {}), ...(learn.onecRef ? { onecRef: learn.onecRef } : {}),
      },
    });
  }
  return out;
}

// ── Listing and the 1C «Контрагенты» import ────────────────────────────────────────────────

export type CounterpartyListRow = {
  id: string; clientId: string | null; name: string; inn: string | null; account: string | null; mfo: string | null;
  aliases: string[]; onecRef: string | null; source: string; createdAt: string;
  kind: string | null; branchCode: string | null; vatCode: string | null;
};

export const COUNTERPARTY_PAGE = 50;

export async function listCounterparties(
  orgId: string, scope: { clientIds: string[] | null; clientId?: string | null }, q: string | undefined, page: number,
): Promise<{ rows: CounterpartyListRow[]; total: number; pageSize: number }> {
  const search = (q ?? '').trim();
  const norm = normalizeName(search);
  const where: Prisma.CounterpartyWhereInput = {
    orgId,
    ...(scope.clientIds !== null ? { clientId: { in: scope.clientIds } } : {}),
    ...(scope.clientId !== undefined ? { clientId: scope.clientId } : {}),
    ...(search ? { OR: [{ normalizedName: { contains: norm || search } }, { inn: { startsWith: search } }, { account: { startsWith: search } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.counterparty.findMany({ where, orderBy: { name: 'asc' }, skip: page * COUNTERPARTY_PAGE, take: COUNTERPARTY_PAGE }),
    db.counterparty.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id, clientId: r.clientId, name: r.name, inn: r.inn, account: r.account, mfo: r.mfo, aliases: r.aliases, onecRef: r.onecRef,
      source: r.source, createdAt: r.createdAt.toISOString(), kind: r.kind, branchCode: r.branchCode, vatCode: r.vatCode,
    })),
    total, pageSize: COUNTERPARTY_PAGE,
  };
}

/**
 * Header words of a 1C «Контрагенты» list (Russian interface, Uzbek and English variants), lower-cased.
 * «Вывести список» writes the list's own column captions, whichever subset the accountant ticked
 * (onec §6, §8.17): Наименование, Полное наименование, Код, ИНН, ПИНФЛ, Регистрационный код
 * плательщика НДС, Код филиала, Вид контрагента; a Tasnivo counterparties_xlsx adds Расчетный счет, МФО, Банк.
 */
const COLUMN_WORDS: Record<'name' | 'fullName' | 'code' | 'inn' | 'pinfl' | 'vatCode' | 'branch' | 'kind' | 'account' | 'mfo' | 'bank', readonly string[]> = {
  name: ['наименование', 'наименование краткое', 'контрагент', 'nomi', 'name', 'kontragent', 'номи'],
  fullName: ['полное наименование', 'наименование полное', 'наименование для печати', "to'liq nomi", 'toʻliq nomi', 'full name'],
  code: ['код', 'kod', 'code'],
  inn: ['инн', 'инн/пинфл', 'инн / пинфл', 'stir', 'стир', 'inn', 'tin'],
  pinfl: ['пинфл', 'jshshir', 'жшшир', 'pinfl'],
  vatCode: ['регистрационный код плательщика ндс', 'рег. код плательщика ндс', 'регистрационный код ндс', 'код плательщика ндс', 'qqs to\'lovchi kodi', 'qqs kodi', 'vat code'],
  branch: ['код филиала', 'филиал', 'filial kodi', 'branch code'],
  kind: ['вид контрагента', 'юр./физ. лицо', 'юридическое / физическое лицо', 'тип контрагента', 'резидентство', 'kontragent turi', 'type'],
  account: ['расчетный счет', 'расчётный счёт', 'р/с', 'счет', 'номер счета', 'банковский счет', 'основной банковский счет', 'hisob raqami', 'hisob raqam', 'account'],
  mfo: ['мфо', 'mfo', 'код банка', 'бик', 'бик банка'],
  bank: ['банк', 'наименование банка', 'bank'],
};

export type ColumnPick = Record<keyof typeof COLUMN_WORDS, number>;

const clean = (h: string): string => h.toLowerCase().replace(/ё/g, 'е').replace(/[ʻʼ‘’`]/g, "'").replace(/\s+/g, ' ').trim();

/** Which column holds what, by header words; -1 = not in the file. Pure. */
export function counterpartyColumns(headers: readonly string[]): ColumnPick {
  const cells = headers.map(clean);
  const out = {} as ColumnPick;
  const taken = new Set<number>();
  const free = (i: number): boolean => i >= 0 && !taken.has(i);
  // Exact captions first for every key, then the longer words as a prefix: «Наименование банка»
  // must not become the name, «Код филиала» not the code, «Полное наименование» not the name.
  const order = ['vatCode', 'branch', 'kind', 'fullName', 'pinfl', 'inn', 'account', 'mfo', 'bank', 'code', 'name'] as const;
  for (const key of order) {
    const words = COLUMN_WORDS[key].map((w) => clean(w));
    out[key] = cells.findIndex((h, i) => free(i) && words.includes(h));
    if (out[key] >= 0) taken.add(out[key]);
  }
  for (const key of order) {
    if (out[key] >= 0) continue;
    const words = COLUMN_WORDS[key].map((w) => clean(w)).filter((w) => w.length > 3);
    out[key] = cells.findIndex((h, i) => free(i) && words.some((w) => h.startsWith(w)));
    if (out[key] >= 0) taken.add(out[key]);
  }
  // A list with only «Полное наименование» names its counterparties by it.
  if (out.name < 0 && out.fullName >= 0) { out.name = out.fullName; out.fullName = -1; }
  return out;
}

/**
 * The header row of a «Вывести список» sheet: the first of the top 30 rows with a name column and
 * at least one other known caption (a title, the date or the filter line can stand above it).
 */
export function findHeaderRow(grid: readonly (readonly string[] | undefined)[]): number {
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const row = grid[i];
    if (!row) continue;
    const cols = counterpartyColumns(row);
    const known = Object.values(cols).filter((c) => c >= 0).length;
    if (cols.name >= 0 && known >= 2) return i;
  }
  return -1;
}

export type CounterpartyImport =
  | { ok: true; rows: number; created: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }
  | { ok: false; error: 'unreadable' | 'no_name_column' | 'empty' | 'expired' };

const yes = (v: string): boolean => /^(да|yes|ha|true|1|\+|✓)$/i.test(v.trim());
const no = (v: string): boolean => /^(нет|no|yo['ʻ‘’]?q|false|0|-)$/i.test(v.trim());

/**
 * What a «Вывести список» cell says about the kind: the words of «Вид контрагента», a yes in a «Нерезидент» column, or a
 * no in a «Резидент» / «Резидентство» column (review 30 Oct, R-O9: a "Да" there was read as non-resident, which also
 * lifted the ИНН requirement).
 */
export function kindFromCell(text: string, header: string): CounterpartyKind | null {
  const said = kindOf(text);
  if (said) return said;
  const nonResidentColumn = /нерезидент|non.?resident|norezident/i.test(header);
  const residentColumn = !nonResidentColumn && /резидент|resident|rezident/i.test(header);
  return (nonResidentColumn && yes(text)) || (residentColumn && no(text)) ? 'nonresident' : null;
}

/**
 * Loads a client's counterparties from a 1C «Контрагенты» list saved to Excel («Ещё → Вывести
 * список», any subset of its columns, the header on any of the top rows) or CSV, or a Tasnivo
 * counterparties_xlsx. A row whose ИНН (+ код филиала), account or name is already known updates
 * what the known one lacked; any other becomes a new counterparty with source `onec_export`.
 * Requisites are checked (requisites.ts): a bad ИНН / ПИНФЛ, or no identifier for a legal entity or
 * an individual, keeps the row out; a bad account, МФО or VAT code drops only that field. An МФО
 * Excel stripped of its leading zeros is padded back (B8). Each problem is listed with its row.
 * Refused (`expired`) once the trial or subscription has ended; it does not use the monthly rows (D4).
 */
export async function importCounterparties(orgId: string, clientId: string | null, bytes: Buffer, _filename?: string): Promise<CounterpartyImport> {
  if (!(await uploadsOpen(orgId)).ok) return { ok: false, error: 'expired' };
  let grid: (string[] | undefined)[];
  try {
    grid = (await readGrid(bytes)).grid;
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  const headerAt = findHeaderRow(grid);
  if (headerAt < 0) return { ok: false, error: 'no_name_column' };
  const cols = counterpartyColumns(grid[headerAt] ?? []);
  const body = grid.slice(headerAt + 1).filter((r): r is string[] => Boolean(r?.some((c) => c.trim() !== '')));
  if (body.length === 0) return { ok: false, error: 'empty' };
  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '');
  const errors: { row: number; reason: RequisiteError }[] = [];
  const note = (row: number, reason: RequisiteError): void => { if (errors.length < 50) errors.push({ row, reason }); };
  const refs: (CounterpartyInput & { row: number })[] = [];
  body.forEach((row, i) => {
    const name = cell(row, cols.name) || cell(row, cols.fullName);
    if (!name) return;
    const kindText = cell(row, cols.kind);
    const kind = cols.kind >= 0 ? kindFromCell(kindText, grid[headerAt]?.[cols.kind] ?? '') : kindOf(kindText);
    const checked = checkRequisites({
      inn: cell(row, cols.inn), pinfl: cell(row, cols.pinfl), kind, vatCode: cell(row, cols.vatCode), account: cell(row, cols.account),
      mfo: cell(row, cols.mfo), branchCode: cell(row, cols.branch), budget: true,
    });
    if (checked.fatal) {
      note(i + 1, checked.fatal);
      return;
    }
    for (const w of checked.warnings) note(i + 1, w);
    const v = checked.value;
    refs.push({
      row: i + 1, name: name.slice(0, 300), inn: v.inn, account: v.account, mfo: v.mfo, counterpartyId: null,
      kind: v.kind, branchCode: v.branchCode, vatCode: v.vatCode, onecRef: cell(row, cols.code).slice(0, 80) || null,
    });
  });
  const before = await db.counterparty.count({ where: { orgId, clientId } });
  const recorded = await recordCounterparties(orgId, refs, { clientId, source: 'onec_export' });
  const after = await db.counterparty.count({ where: { orgId, clientId } });
  const created = after - before;
  const ambiguous = recorded.filter((r) => r.match?.status === 'ambiguous').length;
  return { ok: true, rows: body.length, created, updated: recorded.length - created - ambiguous, skipped: body.length - recorded.length + ambiguous, errors };
}
