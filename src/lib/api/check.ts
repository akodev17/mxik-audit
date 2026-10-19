// POST /api/v1/check: runs the same matching and checks as the app for 1..N products.
import { z } from 'zod';
import { auditContext, checkItem } from '../audit-runner';

export const CheckItemSchema = z.object({
  name: z.string().trim().min(1).max(500),
  barcode: z.string().trim().max(32).nullish(),
  unit: z.string().trim().max(60).nullish(),
  mxik: z.string().trim().max(32).nullish(),
});

export type CheckItemInput = z.infer<typeof CheckItemSchema>;

export type CheckResult = {
  name: string;
  markingRequired: boolean;
  findings: {
    type: string;
    severity: string;
    suggestedMxik: string | null;
    confidence: number | null;
    reason: string;
    alternatives: { code: string; name: string; confidence: number }[];
  }[];
};

export async function checkProducts(orgId: string, items: readonly CheckItemInput[]): Promise<CheckResult[]> {
  const ctx = await auditContext(orgId);
  const out: CheckResult[] = [];
  for (const item of items) {
    const result = await checkItem({ rawName: item.name, barcode: item.barcode ?? null, existingMxik: item.mxik ?? null, unit: item.unit ?? null }, ctx);
    out.push({
      name: item.name,
      markingRequired: result.markingRequired,
      findings: result.findings.map((f) => ({
        type: f.type,
        severity: f.severity,
        suggestedMxik: f.suggestedMxik,
        confidence: f.confidence,
        reason: f.reason,
        alternatives: f.alternatives.map((a) => ({ code: a.code, name: a.name, confidence: a.confidence })),
      })),
    });
  }
  return out;
}
