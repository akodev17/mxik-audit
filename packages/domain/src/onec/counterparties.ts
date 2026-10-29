// The org's counterparties: matching what a statement or an invoice names against them (ИНН →
// account → normalised name → alias, docs/TASNIVO_AI_PLAN_2026-10-23.md §4.1), recording the new
// ones, and loading a client's existing list from a 1C «Контрагенты» export before the first
// statement. Aliases are kept as normalised names (normalize.ts), the form matching compares.
import type { Prisma } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { uploadsOpen } from '../plan.js';
import { parseUpload } from '../spreadsheet.js';
import { digitsOnly, normalizeName } from './normalize.js';

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

type Row = { id: string; name: string; normalizedName: string; inn: string | null; account: string | null; mfo: string | null; aliases: string[]; clientId: string | null };
const SELECT = { id: true, name: true, normalizedName: true, inn: true, account: true, mfo: true, aliases: true, clientId: true } as const;

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
export function decide(ref: CounterpartyRef, rows: readonly Row[]): NonNullable<CounterpartyRef['match']> {
  if (blank(ref)) return { status: 'unknown', chosen: null, candidates: [] };
  const norm = normalizeName(ref.name);
  const one = (found: Row[], basis: MatchBasis): NonNullable<CounterpartyRef['match']> | null => {
    if (found.length === 0) return null;
    const candidates = found.slice(0, 10).map((r) => candidate(r, basis === 'name_normalized' && r.name.trim().toLowerCase() === ref.name.trim().toLowerCase() ? 'name_exact' : basis));
    return found.length === 1
      ? { status: 'matched', chosen: candidates[0] ?? null, candidates }
      : { status: 'ambiguous', chosen: null, candidates };
  };
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
export async function matchCounterparties(orgId: string, refs: CounterpartyRef[], scope: CounterpartyScope = {}): Promise<CounterpartyRef[]> {
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
export async function recordCounterparties(orgId: string, refs: CounterpartyRef[], options: RecordOptions = {}): Promise<CounterpartyRef[]> {
  const matched = await matchCounterparties(orgId, refs, options);
  const created = new Map<string, MatchCandidate>();
  const learned = new Map<string, { aliases: Set<string>; inn?: string; account?: string; mfo?: string }>();
  const byId = new Map((await candidatesFor(orgId, matched, options)).map((r) => [r.id, r]));
  const out: CounterpartyRef[] = [];
  for (const ref of matched) {
    const norm = normalizeName(ref.name);
    if (ref.match?.status === 'new' && norm) {
      const key = ref.inn ? `inn:${ref.inn}` : ref.account ? `acc:${ref.account}` : `name:${norm}`;
      let chosen = created.get(key);
      if (!chosen) {
        const row = await db.counterparty.create({
          data: {
            orgId, clientId: options.clientId ?? null, name: ref.name.trim(), normalizedName: norm, inn: ref.inn, account: ref.account, mfo: ref.mfo,
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
      learned.set(row.id, learn);
    }
    out.push(ref);
  }
  for (const [id, learn] of learned) {
    const row = byId.get(id);
    if (!row || (learn.aliases.size === 0 && !learn.inn && !learn.account && !learn.mfo)) continue;
    await db.counterparty.update({
      where: { id },
      data: {
        ...(learn.aliases.size > 0 ? { aliases: [...row.aliases, ...learn.aliases].slice(-50) } : {}),
        ...(learn.inn ? { inn: learn.inn } : {}), ...(learn.account ? { account: learn.account } : {}), ...(learn.mfo ? { mfo: learn.mfo } : {}),
      },
    });
  }
  return out;
}

// ── Listing and the 1C «Контрагенты» import ────────────────────────────────────────────────

export type CounterpartyListRow = {
  id: string; clientId: string | null; name: string; inn: string | null; account: string | null; mfo: string | null;
  aliases: string[]; onecRef: string | null; source: string; createdAt: string;
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
      source: r.source, createdAt: r.createdAt.toISOString(),
    })),
    total, pageSize: COUNTERPARTY_PAGE,
  };
}

/** Header words of a 1C «Контрагенты» list (Russian interface, Uzbek and English variants), lower-cased. */
const COLUMN_WORDS: Record<'name' | 'inn' | 'account' | 'mfo' | 'bank', readonly string[]> = {
  name: ['наименование', 'полное наименование', 'наименование полное', 'контрагент', 'nomi', 'name', 'kontragent'],
  inn: ['инн', 'инн/пинфл', 'пинфл', 'stir', 'inn', 'tin', 'jshshir'],
  account: ['расчетный счет', 'расчётный счёт', 'р/с', 'счет', 'банковский счет', 'основной банковский счет', 'hisob raqami', 'hisob raqam', 'account'],
  mfo: ['мфо', 'mfo', 'код банка', 'бик'],
  bank: ['банк', 'наименование банка', 'bank'],
};

export type ColumnPick = Record<keyof typeof COLUMN_WORDS, number>;

/** Which column holds what, by header words; -1 = not in the file. Pure. */
export function counterpartyColumns(headers: readonly string[]): ColumnPick {
  const clean = headers.map((h) => h.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim());
  const pick = (words: readonly string[]): number => {
    const folded = words.map((w) => w.replace(/ё/g, 'е'));
    const exact = clean.findIndex((h) => folded.includes(h));
    return exact >= 0 ? exact : clean.findIndex((h) => folded.some((w) => w.length > 3 && h.startsWith(w)));
  };
  const out = {} as ColumnPick;
  const taken = new Set<number>();
  // Name last among the startsWith matches: "наименование банка" must not become the name column.
  for (const key of ['inn', 'account', 'mfo', 'bank', 'name'] as const) {
    const words = COLUMN_WORDS[key];
    let index = pick(words);
    if (taken.has(index)) index = clean.findIndex((h, i) => !taken.has(i) && words.includes(h));
    out[key] = index;
    if (index >= 0) taken.add(index);
  }
  return out;
}

export type CounterpartyImport =
  | { ok: true; rows: number; created: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }
  | { ok: false; error: 'unreadable' | 'no_name_column' | 'empty' | 'expired' };

/**
 * Loads a client's counterparties from a 1C «Контрагенты» export (.xlsx or CSV): columns
 * Наименование, ИНН, Расчетный счет, МФО / Банк. A row whose ИНН (or else account, or else name)
 * is already known updates what the known one lacked; any other becomes a new counterparty with
 * source `onec_export`. Rows with an ИНН that is not 9 or 14 digits are skipped and listed.
 * Refused (`expired`) once the trial or subscription has ended; it does not use the monthly rows (D4).
 */
export async function importCounterparties(orgId: string, clientId: string | null, bytes: Buffer, filename?: string): Promise<CounterpartyImport> {
  if (!(await uploadsOpen(orgId)).ok) return { ok: false, error: 'expired' };
  let sheet;
  try {
    sheet = await parseUpload(bytes, filename);
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  const cols = counterpartyColumns(sheet.headers);
  if (cols.name < 0) return { ok: false, error: 'no_name_column' };
  if (sheet.rows.length === 0) return { ok: false, error: 'empty' };
  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '');
  const errors: { row: number; reason: string }[] = [];
  const refs: (CounterpartyRef & { row: number })[] = [];
  sheet.rows.forEach((row, i) => {
    const name = cell(row, cols.name);
    if (!name) return;
    const innText = digitsOnly(cell(row, cols.inn));
    const accText = digitsOnly(cell(row, cols.account));
    const mfoText = digitsOnly(cell(row, cols.mfo));
    if (innText && !/^(\d{9}|\d{14})$/.test(innText)) {
      if (errors.length < 50) errors.push({ row: i + 1, reason: 'inn_invalid' });
      return;
    }
    refs.push({
      row: i + 1, name: name.slice(0, 300), inn: innText, account: accText && /^\d{20}$/.test(accText) ? accText : null,
      mfo: mfoText && /^\d{5}$/.test(mfoText) ? mfoText : null, counterpartyId: null,
    });
  });
  const before = await db.counterparty.count({ where: { orgId, clientId } });
  const recorded = await recordCounterparties(orgId, refs, { clientId, source: 'onec_export' });
  const after = await db.counterparty.count({ where: { orgId, clientId } });
  const created = after - before;
  const ambiguous = recorded.filter((r) => r.match?.status === 'ambiguous').length;
  return { ok: true, rows: sheet.rows.length, created, updated: recorded.length - created - ambiguous, skipped: sheet.rows.length - recorded.length + ambiguous, errors };
}
