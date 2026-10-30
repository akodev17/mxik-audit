// What the local tasnif mirror knows about the codes of an invoice: the classifier export
// (mxik_code: existence, retirement, bound units, marking, tax privileges), the restricted list
// (restricted_code), the packaging codes fetched so far (packaging_code + mxik_code_state) and the
// activity the Tasnif API reported. One query per table for all distinct codes of a document, so a
// bulk run over thousands of lines stays cheap. Read-only; rules.ts turns the facts into issues.
import { db } from '@tasnivo/db';

export type MirrorPackage = { code: string; name: string; unitId: number | null };

export type MirrorFact = {
  code: string;
  exists: boolean;
  /** `YYYY-MM-DD` the export stopped listing the code (≈ the deactivation notice), null while listed. */
  retiredAt: string | null;
  unitIds: number[];
  unitCanonical: string[];
  /** strict = the code allows only these units (§5 V3); recommended / none = advice only. */
  unitBinding: string | null;
  isMarked: boolean | null;
  privilegeIds: string[];
  /** `YYYY-MM-DD` from which the code is refused (restricted_code), null when not listed. */
  restrictedFrom: string | null;
  /** The code's packages when they were fetched from Tasnif; null = never fetched (no package check possible). */
  packages: MirrorPackage[] | null;
  /** isActive from the Tasnif history endpoint, when it was asked. */
  apiActive: boolean | null;
};

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export async function mirrorFacts(codes: readonly string[]): Promise<Map<string, MirrorFact>> {
  const wanted = [...new Set(codes.filter((c) => /^\d{17}$/.test(c)))];
  const out = new Map<string, MirrorFact>();
  if (wanted.length === 0) return out;
  const [rows, restricted, states, packages] = await Promise.all([
    db.mxikCode.findMany({
      where: { code: { in: wanted } },
      select: { code: true, retiredAt: true, unitIds: true, unitCanonical: true, unitBinding: true, isMarked: true, taxPrivilegeIds: true },
    }),
    db.restrictedCode.findMany({ where: { code: { in: wanted } }, select: { code: true, effectiveFrom: true } }),
    db.mxikCodeState.findMany({ where: { code: { in: wanted } }, select: { code: true, isActive: true, packagesFetchedAt: true } }),
    db.packagingCode.findMany({ where: { mxikCode: { in: wanted } }, select: { code: true, mxikCode: true, name: true, nameRu: true, unitId: true } }),
  ]);
  const restrictedBy = new Map(restricted.map((r) => [r.code.trim(), day(r.effectiveFrom)]));
  const stateBy = new Map(states.map((s) => [s.code.trim(), s]));
  const packagesBy = new Map<string, MirrorPackage[]>();
  for (const p of packages) {
    const key = p.mxikCode.trim();
    packagesBy.set(key, [...(packagesBy.get(key) ?? []), { code: p.code, name: p.nameRu ?? p.name, unitId: p.unitId }]);
  }
  const found = new Map(rows.map((r) => [r.code.trim(), r]));
  for (const code of wanted) {
    const r = found.get(code);
    const state = stateBy.get(code);
    out.set(code, {
      code, exists: Boolean(r), retiredAt: day(r?.retiredAt ?? null),
      unitIds: r?.unitIds ?? [], unitCanonical: r?.unitCanonical ?? [], unitBinding: r?.unitBinding ?? null,
      isMarked: r?.isMarked ?? null, privilegeIds: r?.taxPrivilegeIds ?? [],
      restrictedFrom: restrictedBy.get(code) ?? null,
      packages: state?.packagesFetchedAt ? packagesBy.get(code) ?? [] : packagesBy.has(code) ? packagesBy.get(code) ?? [] : null,
      apiActive: state?.isActive ?? null,
    });
  }
  return out;
}
