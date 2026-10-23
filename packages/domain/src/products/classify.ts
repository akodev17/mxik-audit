// classifyProducts: what the classifier says about each line's MXIK, and which code to use when
// it is missing or doubtful. Runs the audit's own cascade (checkItem: firm dictionary, barcode,
// exact name, lexical + vector, the LLM reranker only for rows its gate calls uncertain) and its
// checks (NOT_FOUND, MISMATCH, UNIT_CONFLICT, RESTRICTED), then adds what an accounting import needs
// on top: activity per the Tasnif API, packaging-code consistency, marking. Server-only.
import { sharesMeaning } from '@tasnivo/core/match/relevance';
import { hierarchyPath } from '@tasnivo/core/match/rules';
import { MISMATCH_THRESHOLD, restrictionDate } from '@tasnivo/core/audit/checks';
import { markingRequired as markingOf } from '@tasnivo/core/audit/marking';
import { barcodeIdentity, resolveUnit } from '@tasnivo/core/normalize/index';
import type { ScoredCandidate } from '@tasnivo/core/match/types';
import type { accounting } from '@tasnivo/contracts';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { z } from 'zod';
import { auditContext, checkItem, type AuditContext } from '../audit-runner.js';
import { runPool } from '../work-pool.js';
import { mxikOf } from './keys.js';
import { activityFor, packagesFor, type PackagesState } from './packaging.js';
import { tasnifClient, type TasnifClient } from './tasnif-client.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;
export type MxikStatus = ProductRecord['mxikStatus'];

export type ClassifyLine = { name: string; mxik?: string | null; barcode?: string | null; unit?: string | null; packageCode?: string | null };

/** What every caller gets (the §4.4 Pick), plus the issues behind the status. */
export type Classification = Pick<ProductRecord, 'mxik' | 'mxikName' | 'mxikStatus' | 'mxikSuggestion' | 'packageCode' | 'packageName' | 'markingRequired'> & {
  issues: ValidationIssue[];
};

/** For the product drawer and the import grid: the runners-up as well. */
export type DetailedClassification = Classification & { alternatives: MatchCandidate[] };

export type ClassifyOptions = {
  locale?: Locale;
  /** Reused across chunks of one import; built per call otherwise. */
  ctx?: AuditContext;
  client?: TasnifClient;
  /**
   * given (default): fetch packaging only for lines that name a package code. all: also for lines
   * without one, to suggest it (one Tasnif call per new code). off: no packaging check.
   */
  packaging?: 'given' | 'all' | 'off';
  /** Ask the history endpoint for codes whose activity is not cached (default: cache only). */
  liveActivity?: boolean;
  /** Rows matched at once; each costs a handful of queries. */
  concurrency?: number;
  today?: Date;
};

const ALTERNATIVES = 5;
const fill = (template: string, params: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));

/** The candidate's name in the reader's language. */
function codeName(c: ScoredCandidate['candidate'], locale: Locale): string {
  return (locale === 'ru' ? c.nameRu || c.nameUz : c.nameUz || c.nameRu) || c.code;
}

/** One sentence why a code was suggested, from the stage that produced it. */
export function suggestionReason(s: ScoredCandidate, locale: Locale): { basis: MatchCandidate['basis']; reason: string } {
  const r = i18nFor(locale).ta.productsX.reasons;
  switch (s.stage) {
    case 'barcode': return { basis: 'barcode', reason: r.barcode };
    case 'dictionary': return { basis: 'confirmed_mapping', reason: r.dictionary };
    case 'exact': return { basis: 'name_exact', reason: r.exact };
    case 'rerank': return { basis: 'ai', reason: fill(r.ai, { reason: s.evidence.rerankReason ?? s.reason }) };
    default: return { basis: 'name_normalized', reason: fill(r.similar, { pct: Math.round(s.confidence * 100), path: hierarchyPath(s.candidate) }) };
  }
}

export function toCandidate(s: ScoredCandidate, locale: Locale): MatchCandidate {
  const { basis, reason } = suggestionReason(s, locale);
  return { id: s.candidate.code, label: `${s.candidate.code} · ${codeName(s.candidate, locale)}`, confidence: Math.max(0, Math.min(1, s.confidence)), basis, reason };
}

const SEVERITY_RANK: Record<MxikStatus, number> = { invalid: 6, inactive: 5, restricted: 4, missing: 3, suspicious: 2, ok: 1, unchecked: 0 };
const worse = (a: MxikStatus, b: MxikStatus): MxikStatus => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);

/** Packaging checks for a line whose code is known; pure over the fetched package list. */
export function packagingIssues(
  line: Pick<ClassifyLine, 'packageCode' | 'unit'>, code: string, state: PackagesState | undefined,
): { issues: ValidationIssue[]; packageName: string | null } {
  const given = line.packageCode?.trim() || null;
  if (!state) return { issues: [], packageName: null };
  if (state.source === 'unavailable') {
    return given
      ? { issues: [{ code: 'package_unchecked', severity: 'info', field: 'packageCode', params: { reason: state.reason ?? 'unavailable' } }], packageName: null }
      : { issues: [], packageName: null };
  }
  if (!given) {
    if (state.packages.length === 0) return { issues: [], packageName: null };
    const only = state.packages.length === 1 ? state.packages[0] : undefined;
    return {
      issues: [{ code: 'package_missing', severity: 'info', field: 'packageCode', params: { count: state.packages.length }, ...(only ? { suggestion: only.code } : {}) }],
      packageName: null,
    };
  }
  const pkg = state.packages.find((p) => p.code === given);
  if (!pkg) {
    return { issues: [{ code: 'package_not_of_code', severity: 'warning', field: 'packageCode', params: { packageCode: given, code } }], packageName: null };
  }
  const issues: ValidationIssue[] = [];
  // The package counts pieces of its unit (unitId); a line priced per kilogram cannot carry a "piece" package.
  const rowUnit = resolveUnit(line.unit ?? null);
  if (rowUnit && pkg.unitId !== null && rowUnit.id !== pkg.unitId) {
    issues.push({ code: 'package_unit_conflict', severity: 'warning', field: 'unit', params: { unit: line.unit ?? '', packageUnit: pkg.unitName ?? String(pkg.unitId) } });
  }
  return { issues, packageName: pkg.nameRu ?? pkg.name };
}

/**
 * Classifies each line. Lines are independent; the answer keeps their order. A line the matcher
 * fails on throws (the caller's chunk fails, as an audit row would), never answers a guess.
 */
export async function classifyDetailed(orgId: string, lines: readonly ClassifyLine[], options: ClassifyOptions = {}): Promise<DetailedClassification[]> {
  const locale = options.locale ?? 'uz';
  const today = options.today ?? new Date();
  const client = options.client ?? tasnifClient();
  const ctx = options.ctx ?? await auditContext(orgId);
  const packagingMode = options.packaging ?? 'given';
  const out = new Array<DetailedClassification>(lines.length);
  type Interim = { line: ClassifyLine; code: string | null; check: Awaited<ReturnType<typeof checkItem>> | null; malformed: boolean };
  const interim = new Array<Interim>(lines.length);

  await runPool(lines, options.concurrency ?? 8, async (line, i) => {
    const { code, malformed } = mxikOf(line.mxik);
    const check = await checkItem({ rawName: line.name, barcode: line.barcode ?? null, existingMxik: code, unit: line.unit ?? null }, ctx);
    interim[i] = { line, code, check, malformed };
  });

  // Activity and packaging, once per distinct code, after matching (they need the codes it found valid).
  const validCodes = interim.filter((x) => x.code && x.check?.existing.found).map((x) => x.code as string);
  const activity = await activityFor(validCodes, { live: options.liveActivity ?? false, client, now: today });
  const packagingCodes = packagingMode === 'off' ? [] : interim
    .filter((x) => x.code && x.check?.existing.found && (packagingMode === 'all' || Boolean(x.line.packageCode?.trim())))
    .map((x) => x.code as string);
  const packaging = await packagesFor(packagingCodes, client, today);

  for (const [i, { line, code, check, malformed }] of interim.entries()) {
    if (!check) continue;
    const issues: ValidationIssue[] = [];
    let status: MxikStatus = 'ok';
    const { findings, suggestions, existing } = check;
    const alternatives = suggestions.filter((s) => s.candidate.code !== code).slice(0, ALTERNATIVES).map((s) => toCandidate(s, locale));
    let suggestion: MatchCandidate | null = null;
    const own = code ? suggestions.find((s) => s.candidate.code === code) : undefined;

    if (malformed) {
      status = 'invalid';
      issues.push({ code: 'mxik_malformed', severity: 'error', field: 'mxik', params: { value: (line.mxik ?? '').slice(0, 40) } });
      suggestion = alternatives[0] ?? null;
    }
    for (const f of findings) {
      if (f.type === 'MISSING' && !malformed) {
        status = worse(status, 'missing');
        suggestion = alternatives[0] ?? null;
        issues.push({ code: 'mxik_missing', severity: 'error', field: 'mxik', ...(suggestion ? { suggestion: suggestion.id } : {}) });
      } else if (f.type === 'NOT_FOUND') {
        // Present in an earlier import and absent now = retired by absence; never seen = not a code.
        // A retired code is "inactive per API" once the history endpoint said isActive "0" (cached by
        // the classifier update); otherwise it is inactive by its absence from the export, and `api`
        // says what the API answered, if anything.
        const retired = f.wasRetired;
        const said = code ? activity.get(code) : undefined;
        const issueCode = !retired ? 'mxik_not_found' : said?.isActive === false ? 'mxik_inactive_api' : 'mxik_inactive';
        const api = said?.notFound ? 'not_found' : said?.isActive === true ? 'active' : said?.isActive === false ? 'inactive' : 'unknown';
        status = worse(status, retired ? 'inactive' : 'invalid');
        suggestion = alternatives[0] ?? null;
        issues.push({ code: issueCode, severity: 'error', field: 'mxik', params: { code: code ?? '', ...(retired ? { api } : {}) }, ...(suggestion ? { suggestion: suggestion.id } : {}) });
      } else if (f.type === 'MISMATCH') {
        status = worse(status, 'suspicious');
        suggestion = alternatives[0] ?? null;
        issues.push({ code: 'mxik_suspicious', severity: 'warning', field: 'mxik', params: { selfScore: Math.round((own?.confidence ?? 0) * 100) }, ...(suggestion ? { suggestion: suggestion.id } : {}) });
      } else if (f.type === 'UNIT_CONFLICT') {
        issues.push({
          code: 'unit_conflict', severity: 'warning', field: 'unit',
          params: { unit: line.unit ?? '', expected: existing.candidate?.unitCanonical.join(' / ') ?? '' },
        });
      } else if (f.type === 'RESTRICTED' && f.restriction) {
        // The detailed code of the same position the audit proposes instead (null when there is none).
        const scored = f.suggestedMxik ? suggestions.find((s) => s.candidate.code === f.suggestedMxik) : undefined;
        const replacement: MatchCandidate | null = scored ? toCandidate(scored, locale) : f.suggestedMxik ? {
          id: f.suggestedMxik, label: f.suggestedMxik, confidence: Math.max(0, Math.min(1, f.confidence ?? 0)), basis: 'name_normalized',
          reason: i18nFor(locale).ta.productsX.reasons.restrictedReplacement,
        } : null;
        if (code) {
          const inForce = f.restriction.effectiveFrom.getTime() <= today.getTime();
          status = worse(status, 'restricted');
          suggestion = replacement;
          issues.push({
            code: 'mxik_restricted', severity: inForce ? 'error' : 'warning', field: 'mxik',
            params: { code: f.restriction.code, from: restrictionDate(f.restriction.effectiveFrom) },
            ...(replacement ? { suggestion: replacement.id } : {}),
          });
        } else if (suggestion?.id === f.restriction.code) {
          // A MISSING row is never offered a restricted generalized code: its replacement instead.
          suggestion = replacement;
        }
      }
    }

    // A valid code the matcher did not call a mismatch can still be unrelated to the name: no shared
    // word and a self-score under the mismatch line (relevance.ts, the guard the matcher applies to
    // its own suggestions). Not raised when the matcher found nothing better to offer.
    if (code && existing.found && !existing.retired && existing.candidate && status === 'ok'
        && (own?.confidence ?? 0) < MISMATCH_THRESHOLD && alternatives.length > 0 && !sharesMeaning(line.name, existing.candidate)) {
      status = 'suspicious';
      suggestion = alternatives[0] ?? null;
      issues.push({ code: 'mxik_suspicious', severity: 'warning', field: 'mxik', params: { selfScore: Math.round((own?.confidence ?? 0) * 100) }, ...(suggestion ? { suggestion: suggestion.id } : {}) });
    }

    // Activity per the API (cached): a live code the API calls inactive.
    const act = code ? activity.get(code) : undefined;
    if (code && existing.found && !existing.retired && act?.isActive === false) {
      status = worse(status, 'inactive');
      issues.push({ code: 'mxik_inactive_api', severity: 'error', field: 'mxik', params: { code, status: act.status ?? '' } });
    }

    let packageName: string | null = null;
    if (code && existing.found && packagingMode !== 'off') {
      const pk = packagingIssues(line, code, packaging.get(code));
      issues.push(...pk.issues);
      packageName = pk.packageName;
    }

    const bc = line.barcode?.trim() ? barcodeIdentity(line.barcode) : null;
    if (bc && bc.status === 'bad_check_digit') issues.push({ code: 'barcode_invalid', severity: 'info', field: 'barcode', params: { barcode: line.barcode ?? '' } });

    const marking = markingOf(existing.candidate?.isMarked === true, findings, suggestions);
    if (marking) issues.push({ code: 'marking_required', severity: 'info', field: 'mxik' });

    out[i] = {
      mxik: code,
      mxikName: existing.candidate ? codeName(existing.candidate, locale) : null,
      mxikStatus: status,
      mxikSuggestion: status === 'ok' ? null : suggestion,
      packageCode: line.packageCode?.trim() || null,
      packageName,
      // The row's own valid code decides; otherwise only a confident suggestion's flag (core/audit/marking).
      markingRequired: code && existing.found ? existing.candidate?.isMarked ?? null : marking ? true : null,
      issues,
      alternatives,
    };
  }
  return out;
}

/** The §4.4 shape: the detailed answer without the runners-up. */
export async function classify(orgId: string, lines: readonly ClassifyLine[], options: ClassifyOptions = {}): Promise<Classification[]> {
  const detailed = await classifyDetailed(orgId, lines, options);
  return detailed.map(({ alternatives: _alternatives, ...rest }) => rest);
}
