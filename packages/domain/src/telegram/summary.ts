// The audit summary a catalogue sent through the bot gets back. Counts only
// risky findings, by type, the same way the report does.
import { db } from '../db.js';
import type { Dict } from '../i18n.js';
import { findingTypeCounts } from '../finding-type-counts.js';
import { RISKY_ITEM } from '../risk.js';

const TYPE_ORDER = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'] as const;
export async function auditSummaryText(catalogId: string, reportUrl: string | null, t: Dict): Promise<string> {
  const TYPE_TEXT: Record<string, string> = {
    MISSING: t.typeMissing, NOT_FOUND: t.typeNotFound, MISMATCH: t.typeMismatch, UNIT_CONFLICT: t.typeUnitConflict,
    RESTRICTED: t.typeRestricted, OTHER: t.typeOther,
  };
  const catalog = await db.catalog.findUniqueOrThrow({
    where: { id: catalogId },
    select: { filename: true, rowCount: true, status: true, client: { select: { name: true } } },
  });
  if (catalog.status === 'failed') return t.tgAuditFailed(catalog.filename);

  const [byType, risky, marking] = await Promise.all([
    findingTypeCounts(catalogId, { risky: true }),
    db.catalogItem.count({ where: { catalogId, ...RISKY_ITEM } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true } }),
  ]);
  const counts = new Map<string, number>(byType.map((r) => [r.type, r.count]));
  const lines = [
    t.tgAuditDone(catalog.client?.name ?? ''),
    `${t.tgFile}: ${catalog.filename}`,
    risky === 0 ? t.reportClean(catalog.rowCount) : `${t.reportHeadline(risky, catalog.rowCount)}:`,
    ...TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => `• ${TYPE_TEXT[type] ?? type}: ${counts.get(type) ?? 0}`),
    ...[...counts.keys()].filter((type) => !TYPE_ORDER.includes(type as (typeof TYPE_ORDER)[number]))
      .map((type) => `• ${TYPE_TEXT[type] ?? type}: ${counts.get(type) ?? 0}`),
    marking > 0 ? `${t.markingBadge}: ${marking}` : null,
    reportUrl ? `${t.tgReport}: ${reportUrl}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}
