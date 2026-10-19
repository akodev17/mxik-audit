// The JSON shapes the API answers with, one function per shape. The OpenAPI schemas list
// the same keys; src/lib/api/openapi.test.ts compares them.
import { readDecisionSource } from '../decision-source';

type CatalogRow = {
  id: string; filename: string; clientId: string | null; createdAt: Date;
  status: string; rowCount: number; progressDone: number;
};

export function catalogOut(c: CatalogRow) {
  return {
    id: c.id,
    filename: c.filename,
    clientId: c.clientId,
    createdAt: c.createdAt.toISOString(),
    status: c.status,
    rows: c.rowCount,
    progress: { done: Math.min(c.progressDone, c.rowCount), total: c.rowCount },
  };
}

type FindingRow = {
  id: string; type: string; severity: string; suggestedMxik: string | null; confidence: number | null; reason: string;
  decision: string; chosenMxik: string | null; decisionSource: string | null;
  item: { rowIndex: number; rawName: string; barcode: string | null; unit: string | null; existingMxik: string | null };
};

export function findingOut(f: FindingRow) {
  return {
    id: f.id,
    row: f.item.rowIndex + 1,
    name: f.item.rawName,
    barcode: f.item.barcode,
    unit: f.item.unit,
    currentMxik: f.item.existingMxik,
    type: f.type,
    severity: f.severity,
    suggestedMxik: f.suggestedMxik,
    confidence: f.confidence,
    reason: f.reason,
    decision: f.decision,
    decisionSource: readDecisionSource(f.decisionSource),
    chosenMxik: f.chosenMxik,
  };
}

type ReportInput = {
  catalog: CatalogRow;
  summary: Record<string, number> | null;
  findings: ReturnType<typeof findingOut>[];
  nextCursor: string | null;
};

/** Internal failure details stay in the logs; the caller learns only that the audit failed. */
const FAILED = 'The audit could not be completed. Upload the file again; if it fails again, contact support.';

/** The report keeps one shape in every status: summary and findings stay empty until the audit is ready. */
export function reportOut({ catalog, summary, findings, nextCursor }: ReportInput) {
  return { ...catalogOut(catalog), error: catalog.status === 'failed' ? FAILED : null, summary, findings, nextCursor };
}

export function uploadOut(input: { id: string; rows: number; clientId: string }) {
  return { id: input.id, status: 'analyzing' as const, rows: input.rows, clientId: input.clientId };
}
