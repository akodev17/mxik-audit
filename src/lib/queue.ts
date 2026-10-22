// The review queue: pending high and medium findings across the latest audited
// catalogue of every client the user may see (archived clients left out), in a
// fixed order (high first, then client, then row) with keyset pages.
import { Prisma } from '@prisma/client';
import type { MatchStage } from '../core/match/types';
import { resolveUnit } from '../core/normalize/units';
import { db } from './db';
import { readFindingType } from './finding-type';
import { localDate } from './reminder-dates';
import { FINDING_TYPES, type WsType } from './workspace';

export const QUEUE_DUE = ['overdue', 'week', 'month'] as const;
export type QueueDue = (typeof QUEUE_DUE)[number];

export type QueueFilter = {
  clientId: string | null;
  type: WsType | null;
  severity: 'high' | 'medium' | null;
  /** Rows marked "ask the client". */
  askClient: boolean;
  accountantId: string | null;
  /** Only clients with an open monthly check due in this window. */
  due: QueueDue | null;
};

export type QueueViewer = { orgId: string; clientIds?: string[] | null };

type Params = { client?: string; type?: string; severity?: string; flag?: string; accountant?: string; due?: string };

export function readQueueFilter(p: Params): QueueFilter {
  return {
    clientId: p.client || null,
    type: FINDING_TYPES.find((t) => t === p.type) ?? null,
    severity: p.severity === 'high' || p.severity === 'medium' ? p.severity : null,
    askClient: p.flag === 'ask_client',
    accountantId: p.accountant || null,
    due: QUEUE_DUE.find((d) => d === p.due) ?? null,
  };
}

export type QueueRow = {
  findingId: string;
  rowIndex: number;
  rawName: string;
  unit: string | null;
  type: string;
  severity: 'high' | 'medium';
  existingMxik: string | null;
  suggestedMxik: string | null;
  /** Unit findings only: the unit the code requires (the suggested code is the current one). */
  unitFix: UnitFix | null;
  confidence: number | null;
  stage: MatchStage | null;
  askClient: boolean;
  comments: number;
  catalogId: string;
  catalogName: string;
  auditedAt: Date;
  clientId: string;
  clientName: string;
};

export type UnitFix = { current: string | null; expected: string };

/** The unit a unit-conflict row should carry: the first of its code's units, in the official spelling. */
export function unitFixOf(rowUnit: string | null, codeUnits: readonly string[] | null): UnitFix | null {
  const first = codeUnits?.find((u) => u.trim() !== '');
  if (!codeUnits || !first) return null;
  const official = codeUnits.map(resolveUnit).find((u) => u !== null);
  return { current: rowUnit?.trim() || null, expected: official ? official.latin : first.trim() };
}

export type QueueCursor = { s: number; n: string; c: string; r: number; i: string };

export function encodeQueueCursor(c: QueueCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeQueueCursor(raw: string | null | undefined): QueueCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<QueueCursor>;
    if (typeof c.s === 'number' && typeof c.n === 'string' && typeof c.c === 'string' && typeof c.r === 'number' && typeof c.i === 'string') return c as QueueCursor;
  } catch { /* malformed cursor: start from the top */ }
  return null;
}

/** Clients the queue may draw from: the user's scope, narrowed by the accountant and due filters. Null = all. */
async function queueClients(user: QueueViewer, f: QueueFilter, now: Date): Promise<string[] | null> {
  let ids: string[] | null = user.clientIds ?? null;
  const narrow = (next: string[]): void => { ids = ids === null ? next : ids.filter((id) => next.includes(id)); };

  if (f.accountantId) {
    const person = await db.user.findFirst({
      where: { id: f.accountantId, orgId: user.orgId, role: 'accountant' },
      select: { assignments: { select: { clientId: true } } },
    });
    // An accountant with no assignments works on every client: nothing to narrow.
    if (person && person.assignments.length > 0) narrow(person.assignments.map((a) => a.clientId));
  }
  if (f.due) {
    const today = localDate(now).date;
    const days = f.due === 'overdue' ? 0 : f.due === 'week' ? 7 : 30;
    const dueOn = f.due === 'overdue' ? { lt: today } : { lte: new Date(today.getTime() + days * 86_400_000) };
    const tasks = await db.reminderTask.findMany({ where: { orgId: user.orgId, doneAt: null, dueOn }, select: { clientId: true } });
    narrow([...new Set(tasks.map((t) => t.clientId))]);
  }
  return ids;
}

function latest(orgId: string, ids: string[] | null): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (k."clientId") k."clientId" AS client_id, k.id, k.filename, k."createdAt"
    FROM catalog k JOIN client c0 ON c0.id = k."clientId"
    WHERE k."orgId" = ${orgId} AND c0."orgId" = ${orgId} AND k.status = 'ready'::catalog_status AND c0."archivedAt" IS NULL
      ${ids ? Prisma.sql`AND k."clientId" = ANY(${ids})` : Prisma.empty}
    ORDER BY k."clientId", k."createdAt" DESC, k.id DESC`;
}

function findingConditions(f: QueueFilter): Prisma.Sql[] {
  const where: Prisma.Sql[] = [
    Prisma.sql`f.decision = 'pending'::decision`,
    Prisma.sql`f.severity IN ('high'::severity, 'medium'::severity)`,
  ];
  if (f.type) where.push(Prisma.sql`f.type = ${f.type}::finding_type`);
  if (f.severity) where.push(Prisma.sql`f.severity = ${f.severity}::severity`);
  if (f.askClient) where.push(Prisma.sql`f.flag = 'ask_client'`);
  return where;
}

const STAGES: readonly MatchStage[] = ['barcode', 'exact', 'lexical', 'vector', 'fusion', 'rerank', 'dictionary', 'none'];
const readStage = (s: string | null): MatchStage | null => STAGES.find((x) => x === s) ?? null;

const SEV = Prisma.sql`(CASE WHEN f.severity = 'high'::severity THEN 0 ELSE 1 END)`;

type Raw = {
  finding_id: string; row_index: number; raw_name: string; unit: string | null; type: string; severity: 'high' | 'medium';
  existing_mxik: string | null; suggested_mxik: string | null; confidence: number | null; stage: string | null; flag: string | null;
  code_units: string[] | null; comments: number; catalog_id: string; catalog_name: string; audited_at: Date; client_id: string; client_name: string; sev: number;
};

export type ClientCount = { clientId: string; name: string; findings: number; rows: number };
export type QueuePage = { rows: QueueRow[]; next: string | null; total: number; byClient: ClientCount[] };

export const QUEUE_PAGE = 50;

export async function queuePage(user: QueueViewer, f: QueueFilter, cursor: QueueCursor | null, opts: { limit?: number; now?: Date } = {}): Promise<QueuePage> {
  const limit = Math.min(Math.max(opts.limit ?? QUEUE_PAGE, 1), 200);
  const ids = await queueClients(user, f, opts.now ?? new Date());
  const empty: QueuePage = { rows: [], next: null, total: 0, byClient: [] };
  if (ids !== null && ids.length === 0) return empty;

  const base = Prisma.sql`
    FROM latest l
      JOIN client cl ON cl.id = l.client_id
      JOIN catalog_item i ON i."catalogId" = l.id
      JOIN finding f ON f."itemId" = i.id`;
  const counts = await db.$queryRaw<{ client_id: string; name: string; findings: number; rows: number }[]>(Prisma.sql`
    WITH latest AS (${latest(user.orgId, ids)})
    SELECT cl.id AS client_id, cl.name, count(*)::int AS findings, count(DISTINCT i.id)::int AS rows
    ${base}
    WHERE ${Prisma.join(findingConditions(f), ' AND ')}
    GROUP BY cl.id, cl.name
    ORDER BY findings DESC, cl.name ASC`);
  const byClient = counts.map((c) => ({ clientId: c.client_id, name: c.name, findings: c.findings, rows: c.rows }));

  // A client filter outside what the user may see shows nothing, never someone else's rows.
  if (f.clientId && ids !== null && !ids.includes(f.clientId)) return { ...empty, byClient };
  const where = findingConditions(f);
  if (f.clientId) where.push(Prisma.sql`cl.id = ${f.clientId}`);
  if (cursor) where.push(Prisma.sql`(${SEV}, cl.name, cl.id, i."rowIndex", f.id) > (${cursor.s}, ${cursor.n}, ${cursor.c}, ${cursor.r}, ${cursor.i})`);

  const rows = await db.$queryRaw<Raw[]>(Prisma.sql`
    WITH latest AS (${latest(user.orgId, ids)})
    SELECT f.id AS finding_id, i."rowIndex" AS row_index, i."rawName" AS raw_name, i.unit, f.type::text AS type, f.severity::text AS severity,
      i."existingMxik" AS existing_mxik, f."suggestedMxik" AS suggested_mxik, f.confidence, f.evidence->>'stage' AS stage, f.flag,
      CASE WHEN f.type::text = 'UNIT_CONFLICT' THEN (SELECT m."unitCanonical" FROM mxik_code m WHERE m.code = i."existingMxik") END AS code_units,
      (SELECT count(*)::int FROM finding_comment fc WHERE fc."findingId" = f.id) AS comments,
      l.id AS catalog_id, l.filename AS catalog_name, l."createdAt" AS audited_at, cl.id AS client_id, cl.name AS client_name,
      ${SEV} AS sev
    ${base}
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY sev ASC, cl.name ASC, cl.id ASC, i."rowIndex" ASC, f.id ASC
    LIMIT ${limit + 1}`);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const total = f.clientId
    ? byClient.find((c) => c.clientId === f.clientId)?.findings ?? 0
    : byClient.reduce((n, c) => n + c.findings, 0);
  return {
    byClient,
    total,
    next: rows.length > limit && last
      ? encodeQueueCursor({ s: last.sev, n: last.client_name, c: last.client_id, r: last.row_index, i: last.finding_id })
      : null,
    rows: page.map((r) => ({
      findingId: r.finding_id, rowIndex: r.row_index, rawName: r.raw_name, unit: r.unit, type: readFindingType(r.type), severity: r.severity,
      existingMxik: r.existing_mxik, suggestedMxik: r.suggested_mxik, confidence: r.confidence, stage: readStage(r.stage),
      unitFix: r.type === 'UNIT_CONFLICT' ? unitFixOf(r.unit, r.code_units) : null,
      askClient: r.flag === 'ask_client', comments: r.comments, catalogId: r.catalog_id, catalogName: r.catalog_name,
      auditedAt: r.audited_at, clientId: r.client_id, clientName: r.client_name,
    })),
  };
}

/** The workspace view that shows this row: its name as the search, still-pending rows, and the finding to open. */
export function workspaceHref(r: Pick<QueueRow, 'catalogId' | 'rawName' | 'findingId'>): string {
  const q = new URLSearchParams({ q: r.rawName.slice(0, 100), row: r.findingId });
  return `/catalogs/${r.catalogId}?${q}`;
}
