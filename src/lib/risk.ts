// What counts as a risky row, in one place. Informational findings (severity
// "info") are shown but never counted as risk.
import type { Prisma } from '@prisma/client';

export const RISKY_FINDING: Prisma.FindingWhereInput = { severity: { in: ['high', 'medium'] } };

export const RISKY_ITEM: Prisma.CatalogItemWhereInput = { findings: { some: RISKY_FINDING } };
