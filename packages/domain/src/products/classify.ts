// classifyProducts: what the classifier says about each line's MXIK, and which code to use when
// it is missing or doubtful. Runs the audit's own cascade (checkItem: firm dictionary, barcode,
// exact name, lexical + vector, the LLM reranker only for rows its gate calls uncertain) and its
// checks (NOT_FOUND, MISMATCH, UNIT_CONFLICT, RESTRICTED), then adds what an accounting import needs
// on top: activity per the Tasnif API, packaging-code and unit consistency with the code's card, the
// barcode's own code, a code our classifier copy does not know yet, the 30-day grace of a code the
// operator changed, marking (rules: products/checks.ts, research checklist §7). Server-only.
import { sharesMeaning } from '@tasnivo/core/match/relevance';
import { hierarchyPath } from '@tasnivo/core/match/rules';
import { MISMATCH_THRESHOLD, restrictionDate } from '@tasnivo/core/audit/checks';
import { markingRequired as markingOf } from '@tasnivo/core/audit/marking';
import { barcodeIdentity, identifyingBarcode } from '@tasnivo/core/normalize/index';
import type { ScoredCandidate } from '@tasnivo/core/match/types';
import type { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { z } from 'zod';
import { auditContext, checkItem, type AuditContext } from '../audit-runner.js';
import { runPool } from '../work-pool.js';
import {
  allowedUnits, gtinCodeIssues, packageCountingUnit, packagesForUnit, readBarcodes, retiredGrace, serviceIssues, unitAllowedIssue,
} from './checks.js';
import { mxikOf } from './keys.js';
import { activityFor, packagesFor, type PackagesState } from './packaging.js';
import { tasnifClient, type TasnifAnswer, type TasnifCard, type TasnifClient } from './tasnif-client.js';
import { normalizeUnit } from './units.js';

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
  /**
   * Catalogue import: check each row's barcode against the code the classifier copy (then, for at most
   * GTIN_LIVE_CAP barcodes per call, tasnif's gtin search) holds for it, and ask tasnif about codes the
   * copy does not have (products §7.2, §7.4, §7.5). Off by default (invoices, the product list).
   */
  fileChecks?: boolean;
  /** Rows matched at once; each costs a handful of queries. */
  concurrency?: number;
  today?: Date;
};

const ALTERNATIVES = 5;
/** Barcodes per call asked live when the classifier copy has none (each is one request). */
export const GTIN_LIVE_CAP = 50;
/** Codes per call the copy lacks that are asked live (each is one request). */
export const UNKNOWN_LIVE_CAP = 50;
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

/**
 * Packaging checks for a line whose code is known; pure over the fetched package list (products §7.7,
 * §7.8, §7.10, §7.12): the package must be one of the code's own (an error when the list was just
 * fetched; a warning from the cache, which may predate a package the taxpayer created since); an
 * empty package is derived from the row's unit; the row's unit must be one the code allows.
 */
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
  const issues: ValidationIssue[] = [];
  const rowUnit = normalizeUnit(line.unit ?? null);
  // A unit's name as the card writes it ("килограмм", "шт."), for the messages.
  const names = new Map<number, string>();
  for (const p of state.packages) {
    const id = packageCountingUnit(p);
    if (!names.has(id)) names.set(id, id === p.unitId && p.unitName ? p.unitName : id === 1 ? 'шт.' : p.name);
  }
  const unitCheck = (): void => {
    const u = unitAllowedIssue(line.unit ?? null, allowedUnits(state.packages), names);
    if (u) issues.push(u);
  };
  if (!given) {
    if (state.packages.length === 0) return { issues: [], packageName: null };
    // §7.8: the row's unit picks the package (the plain "килограмм" package for kg); without a unit, the only package.
    const fits = rowUnit ? packagesForUnit(state.packages, rowUnit.id) : state.packages;
    const only = fits.length === 1 ? fits[0] : state.packages.length === 1 ? state.packages[0] : undefined;
    issues.push({ code: 'package_missing', severity: 'info', field: 'packageCode', params: { count: fits.length }, ...(only ? { suggestion: only.code } : {}) });
    unitCheck();
    return { issues, packageName: null };
  }
  const pkg = state.packages.find((p) => p.code === given);
  if (!pkg) {
    const severity = state.source === 'live' ? 'error' : 'warning';
    return { issues: [{ code: 'package_not_of_code', severity, field: 'packageCode', params: { packageCode: given, code } }], packageName: null };
  }
  // A plain-unit package counts in its unit; a consumer pack or a container is one piece (checks.ts).
  const counted = packageCountingUnit(pkg);
  if (rowUnit && rowUnit.id !== counted) {
    issues.push({ code: 'package_unit_conflict', severity: 'warning', field: 'unit', params: { unit: line.unit ?? '', packageUnit: names.get(counted) ?? String(counted) } });
  }
  unitCheck();
  return { issues, packageName: pkg.nameRu ?? pkg.name };
}

/**
 * A code the classifier copy does not list, by what tasnif answered for its card (products §7.2): it
 * exists (the copy is older: a warning), it does not (403, error), or tasnif could not be asked (an
 * error that says so, never "unknown code").
 */
export function unknownCodeVerdict(answer: TasnifAnswer<TasnifCard> | undefined): { code: 'mxik_not_in_copy' | 'mxik_not_found' | 'mxik_unconfirmed'; severity: 'warning' | 'error'; api: string } {
  if (!answer || (!answer.ok && answer.reason === 'disabled')) return { code: 'mxik_not_found', severity: 'error', api: 'unknown' };
  if (answer.ok) return { code: 'mxik_not_in_copy', severity: 'warning', api: 'active' };
  if (answer.reason === 'not_found') return { code: 'mxik_not_found', severity: 'error', api: 'not_found' };
  // A dead network, a timeout, a 5xx: the code is neither known nor unknown yet.
  return { code: 'mxik_unconfirmed', severity: 'error', api: answer.reason };
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
  const fileChecks = options.fileChecks ?? false;

  // §7.2: what tasnif says about a code the copy lacks (never retired, so never seen by an import).
  const unknownCodes = fileChecks && client.live
    ? [...new Set(interim.filter((x) => x.code && x.check?.findings.some((f) => f.type === 'NOT_FOUND' && !f.wasRetired)).map((x) => x.code as string))].slice(0, UNKNOWN_LIVE_CAP)
    : [];
  const unknownAnswers = new Map<string, TasnifAnswer<TasnifCard>>();
  await runPool(unknownCodes, 4, async (code) => { unknownAnswers.set(code, await client.card(code)); });

  // §7.31: when the copy stopped listing a retired code (its 30-day grace).
  const retiredCodes = [...new Set(interim.filter((x) => x.code && x.check?.existing.retired).map((x) => x.code as string))];
  const retiredAt = new Map(retiredCodes.length === 0 ? [] : (await db.mxikCode.findMany({ where: { code: { in: retiredCodes } }, select: { code: true, retiredAt: true } }))
    .flatMap((r) => (r.retiredAt ? [[r.code.trim(), r.retiredAt] as const] : [])));

  // §7.4/§7.5: the code each row's first valid barcode stands for, from the copy, then live for the rest.
  const gtinOf = (line: ClassifyLine): string | null => (fileChecks ? readBarcodes(line.barcode).lookup[0] ?? null : null);
  const gtins = [...new Set(interim.map((x) => gtinOf(x.line)).filter((g): g is string => g !== null))];
  const gtinCode = new Map<string, string | null>();
  if (gtins.length > 0) {
    const byGtin14 = new Map(gtins.map((g) => [identifyingBarcode(g) ?? '', g]));
    const rows = await db.mxikCode.findMany({ where: { barcode: { in: [...byGtin14.keys()] }, retiredAt: null }, select: { code: true, barcode: true } });
    for (const r of rows) {
      const g = byGtin14.get(r.barcode ?? '');
      // A barcode on two codes in the copy says nothing about which one is right.
      if (g) gtinCode.set(g, gtinCode.has(g) ? null : r.code.trim());
    }
    const ask = client.live ? gtins.filter((g) => !gtinCode.has(g)).slice(0, GTIN_LIVE_CAP) : [];
    await runPool(ask, 4, async (g) => {
      const answer = await client.gtin(g);
      if (answer.ok) gtinCode.set(g, answer.value.mxikCode);
    });
  }

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
        suggestion = alternatives[0] ?? null;
        const offer = suggestion ? { suggestion: suggestion.id } : {};
        const since = code ? retiredAt.get(code) : undefined;
        const grace = retired && since && said?.isActive !== false ? retiredGrace(since, today) : null;
        if (grace?.inGrace) {
          // §7.31: a change takes effect 30 days after publication; until then the code is a warning.
          status = worse(status, 'suspicious');
          issues.push({ code: 'mxik_retired_grace', severity: 'warning', field: 'mxik', params: { code: code ?? '', until: grace.until }, ...offer });
        } else if (!retired && fileChecks && code && client.live) {
          const verdict = unknownCodeVerdict(unknownAnswers.get(code));
          status = worse(status, verdict.severity === 'error' ? 'invalid' : 'suspicious');
          issues.push({ code: verdict.code, severity: verdict.severity, field: 'mxik', params: { code, api: verdict.api }, ...offer });
        } else {
          const issueCode = !retired ? 'mxik_not_found' : said?.isActive === false ? 'mxik_inactive_api' : 'mxik_inactive';
          const api = said?.notFound ? 'not_found' : said?.isActive === true ? 'active' : said?.isActive === false ? 'inactive' : 'unknown';
          status = worse(status, retired ? 'inactive' : 'invalid');
          issues.push({ code: issueCode, severity: 'error', field: 'mxik', params: { code: code ?? '', ...(retired ? { api } : {}) }, ...offer });
        }
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

    if (fileChecks) {
      // The import checked the barcode cell itself (checks.ts readBarcodes); here: the barcode's own code.
      const g = gtinOf(line);
      const found = g ? gtinCodeIssues(code, g, gtinCode.get(g) ?? null) : [];
      if (found.some((x) => x.severity !== 'info')) {
        status = worse(status, 'suspicious');
        suggestion ??= found[0]?.suggestion ? { id: found[0].suggestion, label: found[0].suggestion, confidence: 1, basis: 'barcode', reason: i18nFor(locale).ta.productsX.reasons.barcode } : null;
      }
      issues.push(...found, ...serviceIssues(code, line.unit ?? null));
    } else {
      const bc = line.barcode?.trim() ? barcodeIdentity(line.barcode) : null;
      if (bc && bc.status === 'bad_check_digit') issues.push({ code: 'barcode_invalid', severity: 'info', field: 'barcode', params: { barcode: line.barcode ?? '' } });
    }

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
