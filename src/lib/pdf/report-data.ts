// Everything the report PDF (and the share page) prints, loaded and scoped by
// org. Only risky findings are listed, split into unresolved ones and ones a
// person or the system decided; counts cover the whole catalogue.
import { codeDetails } from '../code-details.js';
import { db } from '../db.js';
import { isAutomatic, readDecisionSource, type DecisionSource } from '../decision-source.js';
import { effectiveRow } from '../export-effective.js';
import { readImportMeta } from '../import-diagnostics.js';
import { readPipelineMeta, type PipelineMeta } from '../pipeline-meta.js';
import { RISKY_FINDING, RISKY_ITEM } from '../risk.js';

export const PDF_ROW_LIMIT = 5000;

type Coded = { code: string; name: string | null };

export type PdfRow = {
  rowIndex: number;
  product: string;
  type: string;
  current: Coded | null;
  suggested: Coded | null;
  decision: 'pending' | 'accepted' | 'rejected';
  /** Set when the reviewer accepted a code other than the suggestion. */
  chosen: Coded | null;
  /** Where the decision came from; null while pending or on older decisions. */
  source: DecisionSource | null;
  /** True when no person decided it in this catalogue (carried over or dictionary auto-accept). */
  automatic: boolean;
  /** Who decided (email), for the internal report only. */
  decidedBy: string | null;
};

export type ReportChecks = { purchases: boolean };

export type ReportLimits = {
  /** Rows of the file past the row limit, never checked. */
  notRead: number;
  totalSeen: number;
  /** Rows without a name, not imported. */
  dropped: number;
  badCodes: number;
};

export type ReportPdfData = {
  firmName: string;
  logo: { data: Buffer; mime: string } | null;
  clientName: string;
  filename: string;
  generatedAt: Date;
  /** When the classifier snapshot this audit ran against was taken (Catalog.snapshotId); null if not recorded. */
  classifierDate: Date | null;
  totalRows: number;
  riskyRows: number;
  byType: { type: string; count: number }[];
  markingRows: number;
  rows: PdfRow[];
  truncated: boolean;
  checks: ReportChecks;
  counts: { detected: number; suggested: number; decided: number; automatic: number; unresolved: number };
  /** Risky rows by review state, by the same rule as the exports (export-effective.ts). */
  rowReview: { done: number; partial: number; open: number };
  limits: ReportLimits | null;
  pipeline: PipelineMeta | null;
};

const TYPE_ORDER = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY'];
const AUTOMATIC: DecisionSource[] = ['carry_over', 'dictionary_auto'];

export async function reportPdfData(orgId: string, catalogId: string): Promise<ReportPdfData | null> {
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, orgId, status: 'ready' },
    select: {
      id: true, filename: true, rowCount: true, snapshotId: true, clientId: true, importMeta: true, pipelineMeta: true,
      client: { select: { name: true } },
      org: { select: { name: true, brandName: true, logoData: true, logoMime: true } },
    },
  });
  if (!catalog) return null;
  const inCatalog = { item: { catalogId }, ...RISKY_FINDING };

  const [byType, riskyItems, markingRows, snapshot, findings, suggested, decided, automatic, purchaseCodes] = await Promise.all([
    db.finding.groupBy({ by: ['type'], where: inCatalog, _count: { _all: true } }),
    db.catalogItem.findMany({
      where: { catalogId, ...RISKY_ITEM },
      select: { existingMxik: true, findings: { select: { severity: true, decision: true, chosenMxik: true, decidedAt: true } } },
    }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true } }),
    catalog.snapshotId === null ? Promise.resolve(null) : db.catalogSnapshot.findUnique({ where: { id: catalog.snapshotId }, select: { takenAt: true } }),
    db.finding.findMany({
      where: inCatalog,
      // Unresolved first, so a cut at the limit drops decided rows before open ones.
      orderBy: [{ decision: 'asc' }, { item: { rowIndex: 'asc' } }, { type: 'asc' }],
      take: PDF_ROW_LIMIT + 1,
      select: {
        type: true, suggestedMxik: true, decision: true, chosenMxik: true, decisionSource: true, decidedBy: true,
        item: { select: { rowIndex: true, rawName: true, existingMxik: true } },
      },
    }),
    db.finding.count({ where: { ...inCatalog, suggestedMxik: { not: null } } }),
    db.finding.count({ where: { ...inCatalog, decision: { not: 'pending' } } }),
    db.finding.count({ where: { ...inCatalog, decision: { not: 'pending' }, decisionSource: { in: AUTOMATIC } } }),
    catalog.clientId ? db.purchaseItem.count({ where: { mxik: { not: null }, list: { clientId: catalog.clientId, status: 'ready' } } }) : Promise.resolve(0),
  ]);

  const shown = findings.slice(0, PDF_ROW_LIMIT);
  const [details, users] = await Promise.all([
    codeDetails(shown.flatMap((f) => [f.item.existingMxik, f.suggestedMxik, f.chosenMxik])),
    db.user.findMany({ where: { orgId, id: { in: [...new Set(shown.flatMap((f) => (f.decidedBy ? [f.decidedBy] : [])))] } }, select: { id: true, email: true } }),
  ]);
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const named = (code: string | null): Coded | null => (code ? { code, name: details.get(code)?.name ?? null } : null);
  const detected = byType.reduce((n, b) => n + b._count._all, 0);
  const meta = readImportMeta(catalog.importMeta);
  const reviews = riskyItems.map((item) => effectiveRow(item.existingMxik, item.findings).review);
  const riskyRows = riskyItems.length;

  return {
    firmName: catalog.org.brandName?.trim() || catalog.org.name,
    logo: catalog.org.logoData && catalog.org.logoMime
      ? { data: Buffer.from(catalog.org.logoData), mime: catalog.org.logoMime }
      : null,
    clientName: catalog.client?.name ?? catalog.org.name,
    filename: catalog.filename,
    generatedAt: new Date(),
    classifierDate: snapshot?.takenAt ?? null,
    totalRows: catalog.rowCount,
    riskyRows,
    byType: byType
      .map((r) => ({ type: r.type, count: r._count._all }))
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)),
    markingRows,
    rows: shown.map((f) => {
      const source = readDecisionSource(f.decisionSource);
      return {
        rowIndex: f.item.rowIndex,
        product: f.item.rawName,
        type: f.type,
        current: named(f.item.existingMxik),
        suggested: named(f.suggestedMxik),
        decision: f.decision,
        chosen: f.decision === 'accepted' && f.chosenMxik && f.chosenMxik !== f.suggestedMxik ? named(f.chosenMxik) : null,
        source,
        automatic: f.decision !== 'pending' && isAutomatic(source),
        decidedBy: f.decidedBy ? emails.get(f.decidedBy) ?? null : null,
      };
    }),
    truncated: findings.length > PDF_ROW_LIMIT,
    checks: { purchases: purchaseCodes > 0 },
    counts: { detected, suggested, decided, automatic, unresolved: detected - decided },
    rowReview: {
      done: reviews.filter((r) => r === 'accepted' || r === 'rejected').length,
      partial: reviews.filter((r) => r === 'partial').length,
      open: reviews.filter((r) => r === 'pending').length,
    },
    limits: meta ? {
      notRead: meta.parse.truncated ? Math.max(0, meta.parse.totalSeen - meta.diagnostics.rows) : 0,
      totalSeen: meta.parse.totalSeen,
      dropped: meta.diagnostics.noName.count,
      badCodes: meta.diagnostics.badCodes.count,
    } : null,
    pipeline: readPipelineMeta(catalog.pipelineMeta),
  };
}
