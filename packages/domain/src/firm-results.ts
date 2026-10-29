// What the firm's audits produced, per client: audited catalogues (every version), rows checked, rows
// that failed their check, issues found and resolved, decisions and the last audit. The dashboard's
// value measures are the sums of these rows, and the same rows download as CSV or xlsx. Counted from
// the database only; the caller passes the clients the viewer may see.
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { fmtDate, isoDay } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { clientScope, isAdminRole } from './access.js';
import { csvCell } from './accuracy.js';
import { formulaSafe } from './csv-safe.js';
import { contentDisposition } from './export-filename.js';
import type { CurrentUser } from './session.js';

/** One audited (ready) catalogue's counts. */
export type CatalogResult = {
  id: string; clientId: string; createdAt: Date;
  /** Rows whose check finished; rows with `checkError` are left out. */
  rowsChecked: number;
  /** Rows whose check still failed after its retries (CatalogItem.checkError): not checked. */
  rowsFailed: number;
  /** High and medium findings. */
  issues: number;
  /** Of those, the ones with a decision. */
  resolved: number;
  /** Findings of any severity with a decision, by a person or automatically. */
  decisions: number;
  /** Of those, taken without a person: dictionary auto-accept or carried over from the previous version. */
  autoDecisions: number;
};

type Counts = Omit<CatalogResult, 'id' | 'clientId' | 'createdAt'>;

export type ClientResult = Counts & {
  clientId: string; name: string; isDefault: boolean;
  /** Audited catalogues, every version. */
  catalogs: number;
  lastAuditAt: Date | null;
};

export type ResultClient = { id: string; name: string; isDefault: boolean };

const AUTO_SOURCES = ['dictionary_auto', 'carry_over'];

/** Every audited catalogue of these clients with its counts. */
export async function catalogResults(orgId: string, clientIds: readonly string[]): Promise<CatalogResult[]> {
  if (clientIds.length === 0) return [];
  const rows = await db.$queryRaw<(Counts & { id: string; client_id: string; created_at: Date })[]>(Prisma.sql`
    SELECT k.id, k."clientId" AS client_id, k."createdAt" AS created_at,
      coalesce(r.checked, 0)::int AS "rowsChecked", coalesce(r.failed, 0)::int AS "rowsFailed",
      coalesce(s.issues, 0)::int AS issues, coalesce(s.resolved, 0)::int AS resolved,
      coalesce(s.decisions, 0)::int AS decisions, coalesce(s.auto, 0)::int AS "autoDecisions"
    FROM catalog k
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE i."checkError" IS NULL) AS checked, count(*) FILTER (WHERE i."checkError" IS NOT NULL) AS failed
      FROM catalog_item i WHERE i."catalogId" = k.id
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity)) AS issues,
        count(*) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity) AND f.decision <> 'pending'::decision) AS resolved,
        count(*) FILTER (WHERE f.decision <> 'pending'::decision) AS decisions,
        count(*) FILTER (WHERE f.decision <> 'pending'::decision AND f."decisionSource" = ANY(${AUTO_SOURCES})) AS auto
      FROM catalog_item i JOIN finding f ON f."itemId" = i.id WHERE i."catalogId" = k.id
    ) s ON true
    WHERE k."orgId" = ${orgId} AND k."clientId" = ANY(${[...clientIds]}) AND k.status = 'ready'::catalog_status`);
  return rows.map(({ id, client_id, created_at, ...counts }) => ({ id, clientId: client_id, createdAt: created_at, ...counts }));
}

const zero = (): Counts => ({ rowsChecked: 0, rowsFailed: 0, issues: 0, resolved: 0, decisions: 0, autoDecisions: 0 });

function add(into: Counts, c: Counts): void {
  into.rowsChecked += c.rowsChecked;
  into.rowsFailed += c.rowsFailed;
  into.issues += c.issues;
  into.resolved += c.resolved;
  into.decisions += c.decisions;
  into.autoDecisions += c.autoDecisions;
}

/** Per client, in the order given; a client without an audited catalogue gets zeros. Pure. */
export function byClient(clients: readonly ResultClient[], catalogs: readonly CatalogResult[]): ClientResult[] {
  const out = new Map<string, ClientResult>(clients.map((c) => [c.id, { clientId: c.id, name: c.name, isDefault: c.isDefault, catalogs: 0, lastAuditAt: null, ...zero() }]));
  for (const k of catalogs) {
    const row = out.get(k.clientId);
    if (!row) continue;
    row.catalogs++;
    add(row, k);
    if (!row.lastAuditAt || k.createdAt > row.lastAuditAt) row.lastAuditAt = k.createdAt;
  }
  return [...out.values()];
}

/** The rows added up. Pure. */
export function resultTotals(rows: readonly ClientResult[]): Counts & { catalogs: number } {
  const total = { catalogs: 0, ...zero() };
  for (const r of rows) {
    total.catalogs += r.catalogs;
    add(total, r);
  }
  return total;
}

/** Clients with an audited catalogue first, the latest audit first; then the rest by name. Pure. */
export function sortResults(rows: readonly ClientResult[]): ClientResult[] {
  return [...rows].sort((a, b) =>
    (b.lastAuditAt?.getTime() ?? -1) - (a.lastAuditAt?.getTime() ?? -1) || a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
}

/**
 * The clients the dashboard shows this viewer: not archived, within their scope, and for an admin who
 * picked an accountant, that accountant's clients (all of them when the accountant has no assignments).
 */
export async function resultClients(user: Pick<CurrentUser, 'orgId' | 'role' | 'clientIds'>, accountantId: string | null): Promise<ResultClient[]> {
  let only: string[] | null = null;
  if (accountantId && isAdminRole(user)) {
    const person = await db.user.findFirst({ where: { id: accountantId, orgId: user.orgId, role: 'accountant' }, select: { assignments: { select: { clientId: true } } } });
    if (person && person.assignments.length > 0) only = person.assignments.map((a) => a.clientId);
  }
  return db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user), ...(only ? { id: { in: only } } : {}) },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, isDefault: true },
  });
}

export type ResultsFormat = 'csv' | 'xlsx';

function table(rows: readonly ClientResult[], locale: Locale): { head: string[]; body: (string | number)[][] } {
  const cols = i18nFor(locale).ta.firmX.value.cols;
  return {
    head: [cols.client, cols.catalogs, cols.rows, cols.failed, cols.issues, cols.resolved, cols.decisions, cols.last],
    body: rows.map((r) => [r.name, r.catalogs, r.rowsChecked, r.rowsFailed, r.issues, r.resolved, r.decisions, r.lastAuditAt ? fmtDate(locale, r.lastAuditAt) : '']),
  };
}

/** UTF-8 with a byte-order mark (Excel reads it), comma-separated, formula-safe cells. Pure. */
export function resultsCsv(rows: readonly ClientResult[], locale: Locale): string {
  const { head, body } = table(rows, locale);
  return `﻿${[head, ...body].map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export async function resultsXlsx(rows: readonly ClientResult[], locale: Locale): Promise<Buffer> {
  const { head, body } = table(rows, locale);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(i18nFor(locale).ta.firmX.value.sheet);
  sheet.columns = [{ width: 40 }, ...head.slice(1, -1).map(() => ({ width: 16 })), { width: 16 }];
  sheet.addRow(head.map(formulaSafe)).font = { bold: true };
  for (const cells of body) sheet.addRow(cells.map((c) => (typeof c === 'string' ? formulaSafe(c) : c)));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export type ResultsFile = { body: Uint8Array | string; headers: Record<string, string> };

/** The per-client table of every client this viewer's dashboard shows, as a download. */
export async function firmResultsFile(
  user: Pick<CurrentUser, 'orgId' | 'role' | 'clientIds'>, opts: { format: ResultsFormat; accountantId: string | null }, locale: Locale, now = new Date(),
): Promise<ResultsFile> {
  const clients = await resultClients(user, opts.accountantId);
  const rows = sortResults(byClient(clients, await catalogResults(user.orgId, clients.map((c) => c.id))));
  const name = `${i18nFor(locale).ta.firmX.value.fileName}-${isoDay(now)}.${opts.format}`;
  const disposition = contentDisposition('attachment', name);
  if (opts.format === 'csv') {
    return { body: resultsCsv(rows, locale), headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': disposition, 'cache-control': 'no-store' } };
  }
  return {
    body: new Uint8Array(await resultsXlsx(rows, locale)),
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': disposition, 'cache-control': 'no-store' },
  };
}
