// Matching and checks per invoice line. Lines are folded into candidate groups first (fold.ts), so
// two spellings of one product are matched once and flagged `duplicate_line_name`; then Agent 4's
// matchProducts / classifyProducts and Agent 1's matchCounterparties run (through `deps`, so tests
// and the benchmark can stub them). Nothing here writes a product or decides for the reviewer:
// every finding is a ValidationIssue, every proposed code a suggestion.
//
// Issue codes this module emits (labels in i18n-parts/didox.ts, didoxX.issues):
//   mxik_missing, mxik_invalid, mxik_inactive, mxik_restricted, mxik_conflict, product_new,
//   product_ambiguous, product_unchecked, package_mismatch, unit_mismatch, totals_mismatch,
//   quantity_invalid, duplicate_line_name, seller_unknown, seller_tin_invalid.
// duplicate_invoice is a refusal of the whole document (service.ts), not a line issue.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { matchCounterparties as onecMatchCounterparties } from '../onec/index.js';
import { classifyProducts as agent4Classify, matchProducts as agent4Match, type Classification, type ProductQuery } from '../products/index.js';
import type { IncomingInvoiceMeta, InvoiceLine, ParsedInvoice, ParsedLine, ValidationIssue } from './document.js';
import { foldName } from './fold.js';

export type MatchResult = z.infer<typeof accounting.MatchResult>;
export type ProductRecord = z.infer<typeof accounting.ProductRecord>;
export type CounterpartyRef = z.infer<typeof accounting.CounterpartyRef>;
export type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];

export type CheckDeps = {
  matchProducts: (orgId: string, clientId: string | null, lines: ProductQuery[]) => Promise<MatchResult[]>;
  classifyProducts: (orgId: string, lines: ProductQuery[]) => Promise<Classification[]>;
  matchCounterparties: (orgId: string, refs: CounterpartyRef[]) => Promise<CounterpartyRef[]>;
  /**
   * The product records behind matched candidates, to compare MXIK and packaging. The §4.4
   * interface has no such read yet (MatchCandidate carries only id and label); proposed to Agent 4
   * in handoff-agent3.md. Until it lands this answers nothing and those comparisons are skipped.
   */
  productRecords: (orgId: string, ids: string[]) => Promise<ProductRecord[]>;
};

export const defaultDeps: CheckDeps = {
  matchProducts: agent4Match,
  classifyProducts: agent4Classify,
  matchCounterparties: onecMatchCounterparties,
  productRecords: () => Promise.resolve([]),
};

export type CheckedLine = {
  payload: InvoiceLine;
  issues: ValidationIssue[];
  status: RecordStatus;
  /** The folded name; lines sharing it are one candidate group. */
  groupKey: string;
};

export type CheckedInvoice = { meta: IncomingInvoiceMeta; lines: CheckedLine[]; batchIssues: ValidationIssue[] };

/** error → unresolved, warning → suspicious, else valid (contract §4.2). */
export function statusFor(issues: readonly ValidationIssue[]): RecordStatus {
  if (issues.some((i) => i.severity === 'error')) return 'unresolved';
  if (issues.some((i) => i.severity === 'warning')) return 'suspicious';
  return 'valid';
}

/** Units and package names compared by meaning: "штук" = "шт" = "дона", "упаковка" = "уп". */
export const sameUnit = (a: string, b: string): boolean => foldName(a) === foldName(b);

const queryOf = (line: ParsedLine): ProductQuery => ({
  name: line.name, mxik: line.mxik, barcode: line.barcode, unit: line.unit ?? line.packageName, packageCode: line.packageCode,
});

/** Classifier verdict → line issues (only those the parser did not raise already). */
function classifierIssues(line: ParsedLine, c: Classification | undefined, has: (code: string) => boolean): ValidationIssue[] {
  if (!c) return [];
  const out: ValidationIssue[] = [];
  const suggestion = c.mxikSuggestion?.id;
  const params = c.mxikSuggestion ? { suggestedName: c.mxikSuggestion.label, reason: c.mxikSuggestion.reason ?? '' } : undefined;
  switch (c.mxikStatus) {
    case 'invalid': if (!has('mxik_invalid')) out.push({ code: 'mxik_invalid', severity: 'error', field: 'mxik', suggestion, params }); break;
    case 'inactive': out.push({ code: 'mxik_inactive', severity: 'error', field: 'mxik', suggestion, params }); break;
    case 'restricted': out.push({ code: 'mxik_restricted', severity: 'error', field: 'mxik', suggestion, params }); break;
    default: break;
  }
  if (!line.mxik && suggestion) {
    // The missing (or unreadable) code's issue carries the classifier's proposal; the reviewer still decides.
    const code = line.rawCatalogCode ? 'mxik_invalid' : 'mxik_missing';
    out.push({ code, severity: 'error', field: 'mxik', suggestion, params: { ...(line.rawCatalogCode ? { value: line.rawCatalogCode.slice(0, 40) } : {}), ...params } });
  }
  return out;
}

export async function checkInvoice(orgId: string, clientId: string | null, parsed: ParsedInvoice, deps: CheckDeps = defaultDeps): Promise<CheckedInvoice> {
  const { lines } = parsed;
  // Candidate groups: first line of each folded name represents the group.
  const keys = lines.map((l) => foldName(l.name) || `#${l.lineNo}`);
  const groupOf = new Map<string, number[]>();
  keys.forEach((k, i) => groupOf.set(k, [...(groupOf.get(k) ?? []), i]));
  const groups = [...groupOf.entries()];
  const representatives = groups.map(([, members]) => lines[members[0] ?? 0] as ParsedLine);

  // The classifier looks at each distinct (group, code) once: a group whose lines carry different
  // codes gets a verdict per code.
  const classKey = (i: number): string => `${keys[i]}|${lines[i]?.mxik ?? ''}`;
  const classFirst = new Map<string, number>();
  lines.forEach((_, i) => { if (!classFirst.has(classKey(i))) classFirst.set(classKey(i), i); });
  const classLines = [...classFirst.values()];
  const [matches, classList] = await Promise.all([
    deps.matchProducts(orgId, clientId, representatives.map(queryOf)),
    deps.classifyProducts(orgId, classLines.map((i) => queryOf(lines[i] as ParsedLine))),
  ]);
  const classes = new Map(classLines.map((lineIndex, k) => [classKey(lineIndex), classList[k]]));
  const chosenIds = [...new Set(matches.flatMap((m) => (m?.status === 'matched' && m.chosen ? [m.chosen.id] : [])))];
  const records = new Map((chosenIds.length ? await deps.productRecords(orgId, chosenIds) : []).flatMap((r) => (r.productId ? [[r.productId, r]] : [])));

  const groupIndex = new Map(groups.map(([key], gi) => [key, gi]));
  const checked: CheckedLine[] = lines.map((line, i) => {
    const key = keys[i] ?? '';
    const gi = groupIndex.get(key) ?? 0;
    const members = groupOf.get(key) ?? [];
    const match: MatchResult = matches[gi] ?? { status: 'unknown', chosen: null, candidates: [] };
    const record = match.status === 'matched' && match.chosen ? records.get(match.chosen.id) ?? null : null;
    const issues: ValidationIssue[] = [...line.issues];
    const has = (code: string): boolean => issues.some((x) => x.code === code);

    for (const issue of classifierIssues(line, classes.get(classKey(i)), has)) {
      const at = issues.findIndex((x) => x.code === issue.code);
      if (at >= 0) issues[at] = { ...issues[at], ...issue }; else issues.push(issue);
    }

    if (members.length > 1) {
      issues.push({ code: 'duplicate_line_name', severity: 'info', field: 'name', params: { lines: members.map((m) => lines[m]?.lineNo ?? m + 1).join(', ') } });
    }

    switch (match.status) {
      case 'new': issues.push({ code: 'product_new', severity: 'warning', field: 'product' }); break;
      case 'ambiguous': issues.push({ code: 'product_ambiguous', severity: 'warning', field: 'product', params: { candidates: match.candidates.length } }); break;
      case 'unknown': issues.push({ code: 'product_unchecked', severity: 'info', field: 'product' }); break;
      default: break;
    }

    if (record) {
      if (line.mxik && record.mxik && line.mxik !== record.mxik) {
        issues.push({ code: 'mxik_conflict', severity: 'warning', field: 'mxik', suggestion: record.mxik, params: { invoice: line.mxik, catalogue: record.mxik } });
      } else if (!line.mxik && record.mxik) {
        // The catalogue knows the code: the missing code is a warning with the catalogue's code proposed.
        const at = issues.findIndex((x) => x.code === 'mxik_missing');
        const issue: ValidationIssue = { code: 'mxik_missing', severity: 'warning', field: 'mxik', suggestion: record.mxik, params: { source: 'catalogue' } };
        if (at >= 0) issues[at] = issue; else issues.push(issue);
      }
      if (line.packageName && record.packageName && !sameUnit(line.packageName, record.packageName)) {
        issues.push({ code: 'package_mismatch', severity: 'warning', field: 'packageName', params: { invoice: line.packageName, catalogue: record.packageName } });
      }
      const lineUnit = line.unit ?? (record.packageName ? null : line.packageName);
      if (lineUnit && record.unit && !sameUnit(lineUnit, record.unit)) {
        issues.push({ code: 'unit_mismatch', severity: 'warning', field: 'unit', params: { invoice: lineUnit, catalogue: record.unit } });
      }
    }

    const { rawCatalogCode: _raw, issues: _own, ...rest } = line;
    const payload: InvoiceLine = { ...rest, product: match, resolved: record };
    return { payload, issues, status: statusFor(issues), groupKey: key };
  });

  // The seller against the org's counterparties (Agent 1's matcher).
  const batchIssues: ValidationIssue[] = [...parsed.documentIssues];
  const [seller] = await deps.matchCounterparties(orgId, [parsed.meta.seller]);
  const meta: IncomingInvoiceMeta = { ...parsed.meta, seller: seller ?? parsed.meta.seller };
  if (seller?.match?.status === 'new' || (seller?.match?.status === 'ambiguous' && !seller.counterpartyId)) {
    batchIssues.push({ code: 'seller_unknown', severity: 'warning', field: 'seller', params: { inn: parsed.meta.seller.inn ?? '', name: parsed.meta.seller.name } });
  }
  return { meta, lines: checked, batchIssues };
}
