// POST /api/v1/check: runs the same matching and checks as the app for 1..N products.
import { z } from 'zod';
import { auditContext, checkItem } from '../audit-runner';
import { dateOnly } from './serialize';

export const CheckItemSchema = z.object({
  name: z.string().trim().min(1).max(500),
  barcode: z.string().trim().max(32).nullish(),
  unit: z.string().trim().max(60).nullish(),
  mxik: z.string().trim().max(32).nullish(),
});

export type CheckItemInput = z.infer<typeof CheckItemSchema>;

type FindingIn = {
  type: string; severity: string; suggestedMxik: string | null; confidence: number | null; reason: string;
  alternatives: readonly { code: string; name: string; confidence: number }[];
  restriction?: { effectiveFrom: Date } | undefined;
};

/** One product's answer; `confidence` is a match score from 0 to 1, not a probability. */
export function checkResultOut(name: string, result: { markingRequired: boolean; findings: readonly FindingIn[] }) {
  return {
    name,
    markingRequired: result.markingRequired,
    findings: result.findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      suggestedMxik: f.suggestedMxik,
      confidence: f.confidence,
      reason: f.reason,
      alternatives: f.alternatives.map((a) => ({ code: a.code, name: a.name, confidence: a.confidence })),
      restrictedFrom: dateOnly(f.restriction?.effectiveFrom),
    })),
  };
}

export type CheckResult = ReturnType<typeof checkResultOut>;

export async function checkProducts(orgId: string, items: readonly CheckItemInput[]): Promise<CheckResult[]> {
  const ctx = await auditContext(orgId);
  const out: CheckResult[] = [];
  for (const item of items) {
    const result = await checkItem({ rawName: item.name, barcode: item.barcode ?? null, existingMxik: item.mxik ?? null, unit: item.unit ?? null }, ctx);
    out.push(checkResultOut(item.name, result));
  }
  return out;
}
