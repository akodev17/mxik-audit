// Privilege findings for an audited catalogue (src/core/audit/privileges.ts),
// run after the main audit. Replaces only pending privilege findings.
import { privilegeCodeFinding, privilegeIds, privilegeOpportunityFinding } from '@tasnivo/core/audit/privileges';
import type { Finding } from '@tasnivo/core/audit/checks';
import { findingData } from './audit-runner.js';
import { db } from '@tasnivo/db';

const PRIVILEGE_TYPES = ['PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY'] as const;
const SUGGESTING_TYPES = new Set(['MISSING', 'NOT_FOUND', 'MISMATCH']);
const LABEL_MAX = 140;

async function labeller(ids: readonly string[]): Promise<(id: string) => string> {
  const rows = await db.taxPrivilege.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nameLatn: true } });
  const names = new Map(rows.map((r) => [r.id, r.nameLatn?.replace(/\s+/g, ' ').trim() ?? '']));
  return (id) => {
    const name = names.get(id);
    if (!name) return `imtiyoz ID ${id}`;
    return name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}…` : name;
  };
}

export async function runPrivilegeCheck(catalogId: string): Promise<number> {
  await db.finding.deleteMany({ where: { item: { catalogId }, type: { in: [...PRIVILEGE_TYPES] }, decision: 'pending' } });
  const items = await db.catalogItem.findMany({
    where: { catalogId },
    select: {
      id: true, existingMxik: true,
      findings: { select: { type: true, decision: true, suggestedMxik: true, chosenMxik: true, decidedAt: true } },
    },
  });

  const current = (item: (typeof items)[number]): string | null => {
    const accepted = item.findings
      .filter((f) => f.decision === 'accepted' && f.chosenMxik)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    return accepted?.chosenMxik ?? item.existingMxik;
  };
  const suggested = (item: (typeof items)[number]): string | null =>
    item.findings.find((f) => SUGGESTING_TYPES.has(f.type) && f.decision === 'pending' && f.suggestedMxik)?.suggestedMxik ?? null;

  const codes = [...new Set(items.flatMap((i) => [current(i), suggested(i)]).filter((c): c is string => c !== null && /^\d{17}$/.test(c)))];
  if (codes.length === 0) return 0;
  const rows = await db.mxikCode.findMany({
    where: { code: { in: codes }, retiredAt: null, NOT: { taxPrivilegeIds: { isEmpty: true } } },
    select: { code: true, taxPrivilegeIds: true },
  });
  const privileges = new Map(rows.map((r) => [r.code.trim(), privilegeIds(r.taxPrivilegeIds)]));
  if (privileges.size === 0) return 0;
  const label = await labeller([...new Set([...privileges.values()].flat())]);

  const data = items.flatMap((item) => {
    const decided = new Set(item.findings.filter((f) => f.decision !== 'pending').map((f) => f.type));
    const own = current(item);
    const ownIds = own ? privileges.get(own) ?? [] : [];
    const out: Finding[] = [];
    if (own && ownIds.length > 0 && !decided.has('PRIVILEGE_CODE')) {
      // A pending name mismatch on the file's own code makes a claimed privilege doubtful.
      const mismatched = own === item.existingMxik && item.findings.some((f) => f.type === 'MISMATCH' && f.decision === 'pending');
      out.push(privilegeCodeFinding(own, ownIds, label, mismatched));
    }
    const next = suggested(item);
    const nextIds = next ? privileges.get(next) ?? [] : [];
    if (next && ownIds.length === 0 && nextIds.length > 0 && !decided.has('PRIVILEGE_OPPORTUNITY')) {
      out.push(privilegeOpportunityFinding(next, nextIds, label));
    }
    return out.length > 0 ? findingData(item.id, out) : [];
  });
  if (data.length > 0) await db.finding.createMany({ data });
  return data.length;
}
