// Everything the client PDF prints, loaded and scoped by org. Only risky
// findings are listed, as on the report screen.
import { codeDetails } from '../code-details.js';
import { db } from '../db.js';
import { RISKY_FINDING, RISKY_ITEM } from '../risk.js';

export const PDF_ROW_LIMIT = 5000;

export type PdfRow = {
  rowIndex: number;
  product: string;
  type: string;
  current: { code: string; name: string | null } | null;
  suggested: { code: string; name: string | null } | null;
  decision: 'pending' | 'accepted' | 'rejected';
  /** Set when the reviewer accepted a code other than the suggestion. */
  chosen: { code: string; name: string | null } | null;
};

export type ReportPdfData = {
  firmName: string;
  logo: { data: Buffer; mime: string } | null;
  clientName: string;
  filename: string;
  generatedAt: Date;
  /** When the classifier snapshot in use was imported. */
  classifierDate: Date | null;
  totalRows: number;
  riskyRows: number;
  byType: { type: string; count: number }[];
  markingRows: number;
  rows: PdfRow[];
  truncated: boolean;
};

const TYPE_ORDER = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'];

export async function reportPdfData(orgId: string, catalogId: string): Promise<ReportPdfData | null> {
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, orgId, status: 'ready' },
    select: {
      id: true, filename: true, rowCount: true,
      client: { select: { name: true } },
      org: { select: { name: true, brandName: true, logoData: true, logoMime: true } },
    },
  });
  if (!catalog) return null;

  const [byType, riskyRows, markingRows, snapshot, findings] = await Promise.all([
    db.finding.groupBy({ by: ['type'], where: { item: { catalogId }, ...RISKY_FINDING }, _count: { _all: true } }),
    db.catalogItem.count({ where: { catalogId, ...RISKY_ITEM } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true } }),
    db.catalogSnapshot.findFirst({ where: { codeCount: { gt: 0 } }, orderBy: { takenAt: 'desc' }, select: { takenAt: true } }),
    db.finding.findMany({
      where: { item: { catalogId }, ...RISKY_FINDING },
      orderBy: [{ item: { rowIndex: 'asc' } }, { type: 'asc' }],
      take: PDF_ROW_LIMIT + 1,
      select: {
        type: true, suggestedMxik: true, decision: true, chosenMxik: true,
        item: { select: { rowIndex: true, rawName: true, existingMxik: true } },
      },
    }),
  ]);

  const shown = findings.slice(0, PDF_ROW_LIMIT);
  const details = await codeDetails(shown.flatMap((f) => [f.item.existingMxik, f.suggestedMxik, f.chosenMxik]));
  const named = (code: string | null) => (code ? { code, name: details.get(code)?.name ?? null } : null);

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
    rows: shown.map((f) => ({
      rowIndex: f.item.rowIndex,
      product: f.item.rawName,
      type: f.type,
      current: named(f.item.existingMxik),
      suggested: named(f.suggestedMxik),
      decision: f.decision,
      chosen: f.decision === 'accepted' && f.chosenMxik && f.chosenMxik !== f.suggestedMxik ? named(f.chosenMxik) : null,
    })),
    truncated: findings.length > PDF_ROW_LIMIT,
  };
}
