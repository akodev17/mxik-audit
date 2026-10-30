// Bank statements in the database: saved layouts (bank_format), operation rules (bank_rule), the
// statement batch (import_batch, kind bank_statement) and its lines (import_record), and the
// processing of a parsed statement in chunks — counterparties through the 1C interface
// (matchCounterparties), operation rules, duplicate checks, optional AI suggestions — with the
// progress written to the batch's counts as it goes. Server-only.
import type { Prisma } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import { BankRecordPayload, BANK_OPERATIONS, BANK_RULE_KINDS, BankColumnMap, BankConventions, type BankOperation, type BankRuleKind } from '@tasnivo/contracts/modules/bank';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { matchCounterparties, type CounterpartyRef } from '../onec/index.js';
import { AI_BATCH, AI_CAP, operationSuggester, type OperationSuggester } from './ai.js';
import { duplicatesInFile, lineFingerprint, sameLine } from './duplicates.js';
import { issue, statusFromIssues } from './issues.js';
import type { ParsedStatement, StatementExtra, StatementLine } from './parse.js';
import { BANK_SIDE_OPERATIONS, decideOperation, type OrgRule, type Owner } from './rules.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type BankStatementMeta = z.infer<typeof accounting.BankStatementMeta>;
type BatchCounts = z.infer<typeof accounting.BatchCounts>;

/** Lines written per chunk (and per progress update). */
export const CHUNK = 500;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

// ── Batch meta ─────────────────────────────────────────────────────────────────────────────

/** import_batch.meta of a bank statement: BankStatementMeta plus the bank workflow's own header. */
export type BankBatchMeta = BankStatementMeta & {
  bank: StatementExtra & {
    progress: { done: number; total: number } | null;
    /** What the AI did: how many lines it was asked about and answered, or why it did not run. */
    ai: { asked: number; answered: number; skipped: 'no_key' | 'cap' | 'failed' | null } | null;
  };
};

export function batchMeta(value: unknown): BankBatchMeta | null {
  if (!value || typeof value !== 'object' || !('bank' in value)) return null;
  return value as BankBatchMeta;
}

/** Counts kept in import_batch.counts: BatchCounts plus approved-and-not-exported and the progress. */
export type BankCounts = BatchCounts & { approved: number; progress?: { done: number; total: number } };

export function batchCounts(value: unknown): BankCounts | null {
  return value && typeof value === 'object' && 'total' in value ? (value as BankCounts) : null;
}

// ── Layouts (bank_format) ─────────────────────────────────────────────────────────────────

export type SavedFormat = { id: string; name: string; verified: boolean; usedCount: number; columnMap: BankColumnMap; conventions: BankConventions; createdAt: Date };

function savedFormat(row: { id: string; name: string; verified: boolean; usedCount: number; columnMap: unknown; conventions: unknown; createdAt: Date }): SavedFormat | null {
  const map = BankColumnMap.safeParse(row.columnMap);
  const conventions = BankConventions.safeParse(row.conventions);
  if (!map.success || !conventions.success) return null;
  return { id: row.id, name: row.name, verified: row.verified, usedCount: row.usedCount, columnMap: map.data, conventions: conventions.data, createdAt: row.createdAt };
}

export async function formatBySignature(orgId: string, signature: string): Promise<SavedFormat | null> {
  if (!signature) return null;
  const row = await db.bankFormat.findUnique({ where: { orgId_headerSignature: { orgId, headerSignature: signature } } });
  return row ? savedFormat(row) : null;
}

export async function listFormats(orgId: string): Promise<SavedFormat[]> {
  const rows = await db.bankFormat.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
  return rows.flatMap((r) => savedFormat(r) ?? []);
}

/** Saves (or replaces) the org's layout for this header signature. */
export async function saveFormat(input: { orgId: string; actorId: string; name: string; signature: string; columnMap: BankColumnMap; conventions: BankConventions }): Promise<string> {
  const data = { name: input.name, columnMap: json(input.columnMap), conventions: json(input.conventions), createdBy: input.actorId };
  const row = await db.bankFormat.upsert({
    where: { orgId_headerSignature: { orgId: input.orgId, headerSignature: input.signature } },
    create: { orgId: input.orgId, headerSignature: input.signature, ...data },
    update: data,
    select: { id: true },
  });
  return row.id;
}

export async function formatUsed(id: string): Promise<void> {
  await db.bankFormat.update({ where: { id }, data: { usedCount: { increment: 1 } } }).catch(() => undefined);
}

export async function removeFormat(orgId: string, id: string): Promise<boolean> {
  return (await db.bankFormat.deleteMany({ where: { id, orgId } })).count > 0;
}

// ── Rules (bank_rule) ─────────────────────────────────────────────────────────────────────

export type RuleRow = OrgRule & { hits: number; createdAt: Date };

const isOperation = (v: string): v is BankOperation => (BANK_OPERATIONS as readonly string[]).includes(v);
const isKind = (v: string): v is BankRuleKind => (BANK_RULE_KINDS as readonly string[]).includes(v);

/** The org's rules a statement of this client may use: the org-wide ones and the client's own. */
export async function loadRules(orgId: string, clientId: string | null): Promise<RuleRow[]> {
  const rows = await db.bankRule.findMany({
    where: { orgId, OR: [{ clientId: null }, ...(clientId ? [{ clientId }] : [])] },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.flatMap((r) => (isKind(r.kind) && isOperation(r.operation)
    ? [{ id: r.id, kind: r.kind, value: r.value, operation: r.operation, cashFlowItem: r.cashFlowItem, priority: r.priority, clientId: r.clientId, hits: r.hits, createdAt: r.createdAt }]
    : []));
}

/** Creates the rule, or updates the operation of the same rule (org, client, kind, value). */
export async function upsertRule(input: { orgId: string; clientId: string | null; actorId: string; kind: BankRuleKind; value: string; operation: BankOperation; cashFlowItem: string | null }): Promise<string> {
  const existing = await db.bankRule.findFirst({ where: { orgId: input.orgId, clientId: input.clientId, kind: input.kind, value: input.value }, select: { id: true } });
  if (existing) {
    await db.bankRule.update({ where: { id: existing.id }, data: { operation: input.operation, cashFlowItem: input.cashFlowItem } });
    return existing.id;
  }
  const row = await db.bankRule.create({
    data: { orgId: input.orgId, clientId: input.clientId, kind: input.kind, value: input.value, operation: input.operation, cashFlowItem: input.cashFlowItem, createdBy: input.actorId },
    select: { id: true },
  });
  return row.id;
}

/** Deletes the rule; with `clientId` given (null = an org-wide rule) only while it still belongs there. */
export async function removeRule(orgId: string, id: string, clientId?: string | null): Promise<boolean> {
  return (await db.bankRule.deleteMany({ where: { id, orgId, ...(clientId !== undefined ? { clientId } : {}) } })).count > 0;
}

async function countHits(hits: ReadonlyMap<string, number>): Promise<void> {
  for (const [id, n] of hits) await db.bankRule.update({ where: { id }, data: { hits: { increment: n } } }).catch(() => undefined);
}

// ── Lines ──────────────────────────────────────────────────────────────────────────────────

type Known = { batchId: string; exported: boolean; payload: BankRecordPayload | null };

/** The lines this org already has in other bank statements under these keys: exported ones and ones still in review. */
async function knownFingerprints(orgId: string, batchId: string, fingerprints: readonly string[]): Promise<Map<string, Known[]>> {
  const out = new Map<string, Known[]>();
  const unique = [...new Set(fingerprints)];
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await db.importRecord.findMany({
      where: { fingerprint: { in: unique.slice(i, i + 1000) }, batchId: { not: batchId }, batch: { orgId, kind: 'bank_statement' }, status: { not: 'skipped' } },
      select: { fingerprint: true, batchId: true, status: true, payload: true },
    });
    for (const row of rows) {
      if (!row.fingerprint) continue;
      const list = out.get(row.fingerprint) ?? [];
      list.push({ batchId: row.batchId, exported: row.status === 'exported', payload: readPayload(row.payload) });
      out.set(row.fingerprint, list);
    }
  }
  return out;
}

/** The earlier copy of a line, if any is the same payment: an exported copy outranks one in review. */
function earlierCopy(line: BankRecordPayload, candidates: readonly Known[] | undefined): Known | undefined {
  const same = (candidates ?? []).filter((k) => !k.payload || sameLine(line, k.payload));
  return same.find((k) => k.exported) ?? same[0];
}

/** The counterparty's match turned into an issue; the line keeps the matched id. */
function matchIssues(ref: CounterpartyRef): ValidationIssue[] {
  if (!ref.name.trim() && !ref.inn) return [];
  switch (ref.match?.status) {
    case 'matched': return [];
    case 'ambiguous': return [issue('counterparty_ambiguous', 'counterparty.name', { candidates: ref.match.candidates.length })];
    case 'new': return [issue('counterparty_new', 'counterparty.name')];
    default: return [issue('counterparty_unknown', 'counterparty.name')];
  }
}

/** Sets the line's operation from the rules; returns the rule id that decided, if an org rule did. */
export function applyRules(line: StatementLine, rules: readonly OrgRule[], owner: Owner, clientId: string | null): string | null {
  const hit = decideOperation(line.payload, rules, owner, clientId);
  line.issues = line.issues.filter((i) => i.code !== 'operation_missing');
  if (!hit) {
    if (line.payload.direction) line.issues.push(issue('operation_missing', 'operation'));
    return null;
  }
  line.payload.operation = hit.operation;
  line.payload.cashFlowItem = hit.cashFlowItem;
  line.payload.decidedBy = hit.decidedBy;
  line.payload.operationSuggestion = null;
  line.issues = line.issues.filter((i) => i.code !== 'operation_suggested');
  // The bank's own fee or acquiring line names no counterparty: that is expected, not a warning.
  if (BANK_SIDE_OPERATIONS.has(hit.operation)) {
    line.issues = line.issues.map((i) => (i.code === 'counterparty_missing' ? { ...i, severity: 'info' as const } : i));
  }
  return hit.ruleId;
}

async function suggest(suggester: OperationSuggester, lines: StatementLine[]): Promise<{ asked: number; answered: number; failed: boolean }> {
  let answered = 0;
  let failed = false;
  for (let i = 0; i < lines.length; i += AI_BATCH) {
    const batch = lines.slice(i, i + AI_BATCH);
    const rows = batch.map((l) => ({ id: String(l.rowIndex), purpose: l.payload.purpose, counterparty: l.payload.counterparty.name, direction: l.payload.direction ?? 'debit' }));
    let answers;
    try {
      answers = await suggester.suggest(rows);
    } catch {
      failed = true;
      break;
    }
    for (const line of batch) {
      const s = answers.get(String(line.rowIndex));
      if (!s) continue;
      answered++;
      line.payload.operationSuggestion = { id: s.operation, label: s.operation, confidence: s.confidence, basis: 'ai', reason: s.reason };
      line.issues.push(issue('operation_suggested', 'operation', { confidence: Math.round(s.confidence * 100) }, s.operation));
    }
  }
  return { asked: lines.length, answered, failed };
}

export type ProcessInput = {
  batchId: string;
  orgId: string;
  clientId: string | null;
  parsed: ParsedStatement;
  /** Overrides the environment's suggester (tests, benchmark); undefined = operationSuggester(). */
  suggester?: OperationSuggester | null;
  /** Stage timings for the benchmark. */
  timings?: Record<string, number>;
};

const time = async <T>(timings: Record<string, number> | undefined, stage: string, run: () => Promise<T>): Promise<T> => {
  const started = performance.now();
  try {
    return await run();
  } finally {
    if (timings) timings[stage] = (timings[stage] ?? 0) + (performance.now() - started);
  }
};

/**
 * Writes the parsed lines as the batch's records, as the parser left them, before any matching:
 * the batch is `uploaded` with progress 0 of n. From here a restart loses nothing (B3): runStatement
 * picks the batch up at its progress. A retry starts by removing what a previous attempt wrote.
 */
export async function storeLines(batchId: string, parsed: ParsedStatement, timings?: Record<string, number>): Promise<void> {
  const lines = parsed.lines;
  const meta: BankBatchMeta = { ...parsed.meta, bank: { ...parsed.extra, progress: { done: 0, total: lines.length }, ai: null } };
  await time(timings, 'store', async () => {
    await db.importRecord.deleteMany({ where: { batchId } });
    for (let start = 0; start < lines.length; start += CHUNK) {
      await db.importRecord.createMany({
        data: lines.slice(start, start + CHUNK).map((line) => ({
          batchId, rowIndex: line.rowIndex, status: statusFromIssues(line.issues), payload: json(line.payload), issues: json(line.issues),
          fingerprint: lineFingerprint(line.payload),
        })),
      });
    }
    await db.importBatch.update({ where: { id: batchId }, data: { meta: json(meta), counts: json({ ...emptyCounts(lines.length), progress: { done: 0, total: lines.length } }), status: 'uploaded', error: null } });
  });
}

export type RunInput = Pick<ProcessInput, 'batchId' | 'suggester' | 'timings'>;

/** Batches this process is working on: one run per batch. */
const running = new Set<string>();
export const isRunning = (batchId: string): boolean => running.has(batchId);

/**
 * Matches, decides and checks the batch's stored lines from its progress on, CHUNK lines at a
 * time: counterparties through the 1C interface, operation rules, duplicates (in the file and
 * against the org's other statements), optional AI suggestions. Each chunk's records and the
 * progress are written in one transaction, so a run stopped by a restart resumes where it was; the
 * batch ends in `review` (or `failed` with the error).
 */
export async function runStatement(input: RunInput): Promise<void> {
  const { batchId, timings } = input;
  if (running.has(batchId)) return;
  running.add(batchId);
  try {
    const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { orgId: true, clientId: true, meta: true, status: true } });
    const meta = batchMeta(batch?.meta);
    if (!batch || !meta || batch.status !== 'uploaded') return;
    const { orgId, clientId } = batch;
    const all = await db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' }, select: { rowIndex: true, fingerprint: true, payload: true } });
    const total = all.length;
    // The upload stopped while its lines were being stored: a part would pass for the whole statement (and the same
    // file is refused as read before), so the statement fails, saying so, until it is removed and uploaded again.
    const expected = meta.bank.progress?.total;
    if (expected !== undefined && expected !== total) {
      await db.importBatch.update({ where: { id: batchId }, data: { status: 'failed', error: `stored ${total} of ${expected} lines: the upload stopped; delete this statement and upload the file again` } });
      return;
    }
    let done = Math.min(meta.bank.progress?.done ?? 0, total);
    const owner: Owner = { inn: meta.ownerInn ?? meta.bank.ownInn, account: meta.account, name: meta.bank.ownName };
    const suggester = input.suggester === undefined ? operationSuggester() : input.suggester;
    const ai: NonNullable<BankBatchMeta['bank']['ai']> = meta.bank.ai ?? { asked: 0, answered: 0, skipped: suggester ? null : 'no_key' };
    let aiBudget = suggester && ai.skipped !== 'failed' ? Math.max(0, AI_CAP - ai.asked) : 0;

    const rules = await time(timings, 'rules_load', () => loadRules(orgId, clientId));
    const fingerprints = all.map((r) => r.fingerprint);
    const inFile = duplicatesInFile(fingerprints, all.map((r) => readPayload(r.payload) ?? r.payload as BankRecordPayload));
    const known = await time(timings, 'duplicates', () => knownFingerprints(orgId, batchId, fingerprints.filter((f): f is string => f !== null)));
    const hits = new Map<string, number>();

    while (done < total) {
      const rows = await db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' }, skip: done, take: CHUNK, select: { id: true, rowIndex: true, payload: true, issues: true } });
      if (rows.length === 0) break;
      const chunk: (StatementLine & { id: string })[] = rows.flatMap((r) => {
        const payload = readPayload(r.payload);
        return payload ? [{ id: r.id, rowIndex: r.rowIndex, payload, issues: (Array.isArray(r.issues) ? r.issues : []) as ValidationIssue[] }] : [];
      });
      const refs = chunk.map((l) => ({ ...l.payload.counterparty }));
      const matched = await time(timings, 'match', async () => {
        try {
          const out = await matchCounterparties(orgId, refs, { clientId });
          return out.length === refs.length ? out : refs;
        } catch {
          return refs.map((r) => ({ ...r, match: { status: 'unknown' as const, chosen: null, candidates: [] } }));
        }
      });
      const started = performance.now();
      const index = new Map(all.map((r, i) => [r.rowIndex, i]));
      chunk.forEach((line, k) => {
        const ref = matched[k] ?? line.payload.counterparty;
        line.payload.counterparty = { name: ref.name, inn: ref.inn, account: ref.account, mfo: ref.mfo, counterpartyId: ref.counterpartyId, ...(ref.match ? { match: ref.match } : {}) };
        line.issues.push(...matchIssues(ref));
        const ruleId = applyRules(line, rules, owner, clientId);
        if (ruleId) hits.set(ruleId, (hits.get(ruleId) ?? 0) + 1);
        const i = index.get(line.rowIndex) ?? -1;
        const fp = fingerprints[i];
        const earlier = fp ? earlierCopy(line.payload, known.get(fp)) : undefined;
        if (earlier?.exported) line.issues.push(issue('duplicate_row', 'fingerprint', { source: 'exported', batchId: earlier.batchId }));
        else if (earlier) line.issues.push(issue('duplicate_pending', 'fingerprint', { batchId: earlier.batchId }));
        const twin = inFile[i] ?? -1;
        if (twin >= 0) line.issues.push(issue('duplicate_row', 'fingerprint', { source: 'file', row: all[twin]?.rowIndex ?? 0 }));
      });
      if (timings) timings['rules_validate'] = (timings['rules_validate'] ?? 0) + (performance.now() - started);

      if (suggester && aiBudget > 0) {
        const undecided = chunk.filter((l) => !l.payload.operation && l.payload.direction).slice(0, aiBudget);
        if (undecided.length > 0) {
          const result = await time(timings, 'ai', () => suggest(suggester, undecided));
          aiBudget -= undecided.length;
          ai.asked += result.asked;
          ai.answered += result.answered;
          if (result.failed) { ai.skipped = 'failed'; aiBudget = 0; }
          else if (aiBudget === 0) ai.skipped = 'cap';
        }
      }

      done += rows.length;
      meta.bank.progress = { done, total };
      meta.bank.ai = ai;
      await time(timings, 'write', () => db.$transaction([
        db.$executeRaw`
          UPDATE import_record AS r SET payload = v.payload, issues = v.issues, status = v.status::"RecordStatus"
          FROM unnest(${chunk.map((l) => l.id)}::text[], ${chunk.map((l) => JSON.stringify(l.payload))}::jsonb[],
                      ${chunk.map((l) => JSON.stringify(l.issues))}::jsonb[], ${chunk.map((l) => statusFromIssues(l.issues))}::text[])
            AS v(id, payload, issues, status)
          WHERE r.id = v.id`,
        db.importBatch.update({ where: { id: batchId }, data: { meta: json(meta), counts: json({ ...emptyCounts(total), progress: { done, total } }) } }),
      ]));
    }

    await countHits(hits);
    meta.bank.ai = ai;
    meta.bank.progress = null;
    await db.importBatch.update({ where: { id: batchId }, data: { meta: json(meta), status: 'review' } });
    await recount(batchId);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'processing failed';
    await db.importBatch.update({ where: { id: batchId }, data: { status: 'failed', error: message } }).catch(() => undefined);
  } finally {
    running.delete(batchId);
  }
}

/** Stores the parsed lines and processes them (the benchmark, tests and the upload's first run). */
export async function processStatement(input: ProcessInput): Promise<void> {
  try {
    await storeLines(input.batchId, input.parsed, input.timings);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'processing failed';
    await db.importBatch.update({ where: { id: input.batchId }, data: { status: 'failed', error: message } }).catch(() => undefined);
    return;
  }
  await runStatement(input);
}

function emptyCounts(total: number): BankCounts {
  return { total, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0, approved: 0 };
}

/** Records approved by a reviewer and not exported yet: what the next 1C export sends. */
export const approvedWhere = (batchId: string): Prisma.ImportRecordWhereInput => ({
  batchId, status: { notIn: ['exported', 'skipped', 'unresolved'] }, decision: { path: ['action'], equals: 'approve' },
});

/**
 * Recounts the batch's records by status and sets the batch's state: `exported` once every line is
 * exported or skipped, `approved` when every open line is approved, else `review`.
 */
export async function recount(batchId: string): Promise<BankCounts> {
  const [groups, approved, batch] = await Promise.all([
    db.importRecord.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } }),
    db.importRecord.count({ where: approvedWhere(batchId) }),
    db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } }),
  ]);
  const counts = emptyCounts(0);
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.total += g._count._all;
  }
  counts.approved = approved;
  const open = counts.total - counts.skipped - counts.exported - approved;
  let status = batch?.status;
  // The 1C layer marks a batch exported on any export; a statement is exported only once nothing is left to send.
  if (status === 'review' || status === 'approved' || status === 'exported') {
    if (counts.exported > 0 && open === 0 && approved === 0) status = 'exported';
    else status = open === 0 && approved > 0 ? 'approved' : 'review';
  }
  await db.importBatch.update({ where: { id: batchId }, data: { counts: json(counts), ...(status ? { status } : {}) } });
  return counts;
}

/** A stored payload, read back through its schema (a hand-edited or older row that does not fit reads as null). */
export function readPayload(value: unknown): BankRecordPayload | null {
  const parsed = BankRecordPayload.safeParse(value);
  return parsed.success ? parsed.data : null;
}
