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
import { duplicatesInFile, lineFingerprint } from './duplicates.js';
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

export async function removeRule(orgId: string, id: string): Promise<boolean> {
  return (await db.bankRule.deleteMany({ where: { id, orgId } })).count > 0;
}

async function countHits(hits: ReadonlyMap<string, number>): Promise<void> {
  for (const [id, n] of hits) await db.bankRule.update({ where: { id }, data: { hits: { increment: n } } }).catch(() => undefined);
}

// ── Lines ──────────────────────────────────────────────────────────────────────────────────

/** Fingerprints this org already has in other bank statements: exported ones and ones still in review. */
async function knownFingerprints(orgId: string, batchId: string, fingerprints: readonly string[]): Promise<Map<string, { batchId: string; exported: boolean }>> {
  const out = new Map<string, { batchId: string; exported: boolean }>();
  const unique = [...new Set(fingerprints)];
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await db.importRecord.findMany({
      where: { fingerprint: { in: unique.slice(i, i + 1000) }, batchId: { not: batchId }, batch: { orgId, kind: 'bank_statement' }, status: { not: 'skipped' } },
      select: { fingerprint: true, batchId: true, status: true },
    });
    for (const r of rows) {
      if (!r.fingerprint) continue;
      const exported = r.status === 'exported';
      // An exported copy outranks one in review.
      if (!out.has(r.fingerprint) || exported) out.set(r.fingerprint, { batchId: r.batchId, exported });
    }
  }
  return out;
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
 * Matches, decides and writes every line of a parsed statement, CHUNK lines at a time, keeping
 * `counts.progress` current; the batch ends in `review` (or `failed` with the error). Lines are
 * written once: a retry after a failure starts by removing what a previous attempt wrote.
 */
export async function processStatement(input: ProcessInput): Promise<void> {
  const { batchId, orgId, clientId, parsed, timings } = input;
  const lines = parsed.lines;
  const owner: Owner = { inn: parsed.extra.ownInn, account: parsed.meta.account, name: parsed.extra.ownName };
  const suggester = input.suggester === undefined ? operationSuggester() : input.suggester;
  const meta: BankBatchMeta = { ...parsed.meta, bank: { ...parsed.extra, progress: { done: 0, total: lines.length }, ai: null } };
  try {
    await db.importRecord.deleteMany({ where: { batchId } });
    await db.importBatch.update({ where: { id: batchId }, data: { meta: json(meta), counts: json(emptyCounts(lines.length)), status: 'uploaded', error: null } });

    const rules = await time(timings, 'rules_load', () => loadRules(orgId, clientId));
    const fingerprints = lines.map((l) => lineFingerprint(l.payload));
    const inFile = duplicatesInFile(fingerprints);
    const known = await time(timings, 'duplicates', () => knownFingerprints(orgId, batchId, fingerprints.filter((f): f is string => f !== null)));
    const hits = new Map<string, number>();
    let aiBudget = suggester ? AI_CAP : 0;
    const ai: NonNullable<BankBatchMeta['bank']['ai']> = { asked: 0, answered: 0, skipped: suggester ? null : 'no_key' };

    for (let start = 0; start < lines.length; start += CHUNK) {
      const chunk = lines.slice(start, start + CHUNK);
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
      chunk.forEach((line, k) => {
        const ref = matched[k] ?? line.payload.counterparty;
        line.payload.counterparty = { name: ref.name, inn: ref.inn, account: ref.account, mfo: ref.mfo, counterpartyId: ref.counterpartyId, ...(ref.match ? { match: ref.match } : {}) };
        line.issues.push(...matchIssues(ref));
        const ruleId = applyRules(line, rules, owner, clientId);
        if (ruleId) hits.set(ruleId, (hits.get(ruleId) ?? 0) + 1);
        const i = start + k;
        const fp = fingerprints[i];
        const earlier = fp ? known.get(fp) : undefined;
        if (earlier?.exported) line.issues.push(issue('duplicate_row', 'fingerprint', { source: 'exported', batchId: earlier.batchId }));
        else if (earlier) line.issues.push(issue('duplicate_pending', 'fingerprint', { batchId: earlier.batchId }));
        const twin = inFile[i] ?? -1;
        if (twin >= 0) line.issues.push(issue('duplicate_row', 'fingerprint', { source: 'file', row: lines[twin]?.rowIndex ?? 0 }));
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

      await time(timings, 'write', async () => {
        await db.importRecord.createMany({
          data: chunk.map((line, k) => ({
            batchId, rowIndex: line.rowIndex, status: statusFromIssues(line.issues), payload: json(line.payload), issues: json(line.issues), fingerprint: fingerprints[start + k] ?? null,
          })),
        });
        const done = Math.min(lines.length, start + CHUNK);
        meta.bank.progress = { done, total: lines.length };
        await db.importBatch.update({ where: { id: batchId }, data: { counts: json({ ...emptyCounts(lines.length), progress: { done, total: lines.length } }) } });
      });
    }

    await countHits(hits);
    meta.bank.ai = ai;
    meta.bank.progress = null;
    await db.importBatch.update({ where: { id: batchId }, data: { meta: json(meta), status: 'review' } });
    await recount(batchId);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'processing failed';
    await db.importBatch.update({ where: { id: batchId }, data: { status: 'failed', error: message } }).catch(() => undefined);
  }
}

function emptyCounts(total: number): BankCounts {
  return { total, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0, approved: 0 };
}

/** Records approved by a reviewer and not exported yet: what the next 1C export sends. */
export const approvedWhere = (batchId: string): Prisma.ImportRecordWhereInput => ({
  batchId, status: { notIn: ['exported', 'skipped', 'unresolved'] }, decision: { path: ['action'], equals: 'approve' },
});

/**
 * Recounts the batch's records by status, and moves the batch between `review` and `approved`
 * (every line approved, skipped or exported). An `exported` batch stays exported.
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
  if (status === 'review' || status === 'approved') status = open === 0 && approved > 0 ? 'approved' : 'review';
  await db.importBatch.update({ where: { id: batchId }, data: { counts: json(counts), ...(status ? { status } : {}) } });
  return counts;
}

/** A stored payload, read back through its schema (a hand-edited or older row that does not fit reads as null). */
export function readPayload(value: unknown): BankRecordPayload | null {
  const parsed = BankRecordPayload.safeParse(value);
  return parsed.success ? parsed.data : null;
}
