// Runs the matching pipeline and the five checks across a stored catalogue,
// then persists findings. Server-only.
import { Pool } from 'pg';
import { startHeartbeat } from './audit-heartbeat.js';
import { db } from './db.js';
import { runPool } from './work-pool.js';
import { embeddingProviderFromEnv } from '../core/embed/index.js';
import { matchProduct, timed, type StageTimer } from '../core/match/pipeline.js';
import { rerankFromEnv } from '../core/match/rerank.js';
import { PostgresRerankCache } from '../core/match/rerank-cache-pg.js';
import { rerankConfigFromEnv } from '../core/match/rerank-config.js';
import { PostgresCandidateStore } from '../core/match/store.js';
import { checkVectorReadiness } from '../core/match/vector-readiness.js';
import { normalizeName } from '../core/normalize/index.js';
import { readCode, runChecks, type Finding, type ResolvedRow } from '../core/audit/checks.js';
import type { RerankGate } from '../core/match/rerank-config.js';
import type { EmbeddingProvider, RerankProvider, RerankUsage, ScoredCandidate } from '../core/match/types.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';

// One pool for the whole server process; the classifier queries are read-only.
const globalForPool = globalThis as unknown as { mxikPool?: Pool };
const pool = globalForPool.mxikPool ?? new Pool({ connectionString: DATABASE_URL, max: 8 });
if (process.env.NODE_ENV !== 'production') globalForPool.mxikPool = pool;

export type AuditProgress = {
  /** Rows processed in this run. */
  done: number;
  /** Rows in the catalogue. */
  total: number;
  /** Every row below this index is fully audited; a resumed run starts here. */
  watermark: number;
};

export type AuditOptions = {
  /** Resume point: rows below this index are already audited. */
  fromRow?: number;
  onProgress?: (p: AuditProgress) => void;
  /** Receives per-stage durations, for performance runs. */
  timer?: StageTimer;
};

export type AuditOutcome = {
  itemsAudited: number;
  findingsCreated: number;
  /** True when stage 4 or 6 ran degraded, so the UI can say so. */
  degraded: boolean;
  degradedReasons: string[];
  /** Null when the reranker was off for this run. */
  llm: RerankUsage | null;
};

/**
 * Audits a catalogue's rows from `fromRow` on, keeping its heartbeat fresh
 * throughout so no other process resumes it in parallel.
 */
export async function auditCatalog(catalogId: string, options: AuditOptions = {}): Promise<AuditOutcome> {
  const heartbeat = await startHeartbeat(catalogId, options.fromRow ?? 0);
  try {
    return await auditRows(catalogId, {
      ...options,
      onProgress: (p) => {
        heartbeat.mark(p.watermark);
        options.onProgress?.(p);
      },
    });
  } finally {
    heartbeat.stop();
  }
}

/**
 * Rows are processed in small concurrent batches: each row costs a handful of
 * Postgres queries, and uncertain rows are grouped into shared LLM calls, so
 * unbounded concurrency would exhaust both.
 */
/** Everything one audit needs to check rows: retrieval, embeddings, reranker. */
export type AuditContext = {
  store: PostgresCandidateStore;
  embedder: EmbeddingProvider;
  reranker: RerankProvider;
  gate: RerankGate;
  timer?: StageTimer | undefined;
  degradedReasons: string[];
};

/** Builds the matching setup for one org; cached LLM verdicts never cross orgs. */
export async function auditContext(orgId: string, timer?: StageTimer): Promise<AuditContext> {
  const configured = embeddingProviderFromEnv();
  const cache = new PostgresRerankCache(pool, orgId, rerankConfigFromEnv(process.env).model);
  const { reranker, gate } = rerankFromEnv(process.env, cache);
  const readiness = await checkVectorReadiness(pool, configured);
  const embedder = readiness.embedder;
  const store = new PostgresCandidateStore(pool, {
    exactVectorScan: !embedder.semantic,
    vectorEnabled: readiness.usable,
  });
  const degradedReasons: string[] = [];
  if (!reranker.available) degradedReasons.push('LLM qayta tartiblash oʻchirilgan');
  if (!embedder.semantic) degradedReasons.push('vektor qidiruv toʻliq semantik emas');
  if (!readiness.usable) degradedReasons.push('vektor bosqichi oʻchirilgan');
  return { store, embedder, reranker, gate, timer, degradedReasons };
}

export type AuditableItem = {
  rawName: string;
  barcode: string | null;
  existingMxik: string | null;
  unit: string | null;
};

export type ItemCheck = { findings: Finding[]; markingRequired: boolean };

const SUGGESTIONS = 5;
const SELF_MATCH_DEPTH = 20;

/** Matches one row and runs every check on it. Writes nothing. */
export async function checkItem(item: AuditableItem, ctx: AuditContext): Promise<ItemCheck> {
  const { store, embedder, reranker, gate, timer } = ctx;
  // Ranked deeper than the suggestions so the row's own code is usually
  // scorable from this one retrieval, without a second pass.
  const match = await matchProduct({
    rawName: item.rawName,
    barcode: item.barcode,
    unit: item.unit,
    existingMxik: item.existingMxik,
  }, { store, embedder, reranker, rerankGate: gate, timer, topK: SELF_MATCH_DEPTH });

  // Resolve the row's own code so NOT_FOUND and retirement can be judged.
  const code = readCode(item.existingMxik);
  let existing: ResolvedRow['existing'] = { found: false, retired: false, candidate: null };
  if (code) {
    existing = await timed(timer, 'existing-code', async () => {
      const state = await store.exists(code);
      return {
        found: state.found,
        retired: state.retired,
        candidate: state.found ? await store.byCode(code) : null,
      };
    });
  }

  // The row's own code must be scorable even when retrieval never surfaced
  // it, otherwise a correct code that happens to rank poorly looks missing.
  let suggestions: ScoredCandidate[] = match.candidates.slice(0, SUGGESTIONS);
  if (code && existing.found && existing.candidate && !suggestions.some((s) => s.candidate.code === code)) {
    let found = match.candidates.find((s) => s.candidate.code === code);
    // A barcode hit skips name retrieval, so only then is a second pass needed.
    if (!found && match.decidedBy === 'barcode') {
      const selfMatch = await timed(timer, 'self-match', () => matchProduct(
        { rawName: item.rawName, unit: item.unit },
        // Same name + unit, so a reranked row is a cache hit here, not a second call.
        { store, embedder, reranker, rerankGate: gate, topK: SELF_MATCH_DEPTH },
      ));
      found = selfMatch.candidates.find((s) => s.candidate.code === code);
    }
    if (found) suggestions = [...suggestions, found];
  }

  const findings = runChecks({
    existingMxik: item.existingMxik,
    unit: item.unit,
    existing,
    suggestions,
  });

  // Marking follows the classifier's own flag on the row's code or on a code we suggest.
  const suggestedMarked = findings.some((f) =>
    suggestions.find((s) => s.candidate.code === f.suggestedMxik)?.candidate.isMarked === true);
  return { findings, markingRequired: existing.candidate?.isMarked === true || suggestedMarked };
}

/** Finding rows ready for createMany. */
export function findingData(itemId: string, findings: readonly Finding[], snapshotId: number | null = null) {
  return findings.map((f) => ({
    itemId,
    type: f.type,
    severity: f.severity,
    suggestedMxik: f.suggestedMxik,
    confidence: f.confidence,
    alternatives: f.alternatives,
    reason: f.reason,
    wasRetired: f.wasRetired,
    evidence: f.evidence ?? undefined,
    snapshotId,
  }));
}

async function auditRows(catalogId: string, options: AuditOptions): Promise<AuditOutcome> {
  const { fromRow = 0, onProgress, timer } = options;
  const catalogOrg = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true } });
  if (!catalogOrg) throw new Error(`no catalogue ${catalogId}`);
  const ctx = await auditContext(catalogOrg.orgId, timer);
  const { degradedReasons, reranker } = ctx;
  // Operator-facing only: never shown on customer screens (see /admin).
  if (degradedReasons.length > 0) console.warn(`[audit ${catalogId}] degraded: ${degradedReasons.join('; ')}`);

  const total = await db.catalogItem.count({ where: { catalogId } });
  const items = await db.catalogItem.findMany({
    where: { catalogId, rowIndex: { gte: fromRow } },
    orderBy: { rowIndex: 'asc' },
    select: {
      id: true, rowIndex: true, rawName: true, barcode: true,
      existingMxik: true, unit: true,
    },
  });

  const CONCURRENCY = 8;
  let done = 0;
  let findingsCreated = 0;
  // Rows finish out of order; the watermark only advances over a contiguous run.
  const finished = new Array<boolean>(items.length).fill(false);
  let contiguous = 0;
  const watermark = (): number => items[contiguous]?.rowIndex ?? total;

  // A failed row stops the run cleanly, so a resume never races leftover workers.
  await runPool(items, CONCURRENCY, async (item, index) => {
    const { findings, markingRequired } = await checkItem(item, ctx);
    if (markingRequired) {
      await db.catalogItem.update({ where: { id: item.id }, data: { markingRequired: true } });
    }
    if (findings.length > 0) {
      await timed(timer, 'persist', () => db.finding.createMany({ data: findingData(item.id, findings) }));
      findingsCreated += findings.length;
    }

    done++;
    finished[index] = true;
    while (finished[contiguous]) contiguous++;
    onProgress?.({ done, total, watermark: watermark() });
  });

  return {
    itemsAudited: items.length,
    findingsCreated,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    llm: reranker.usage?.() ?? null,
  };
}

/** Classifier lookup for the Review screen's "pick another code" box. */
export async function searchClassifier(query: string, limit = 10) {
  const configured = embeddingProviderFromEnv();
  const readiness = await checkVectorReadiness(pool, configured);
  const store = new PostgresCandidateStore(pool, {
    exactVectorScan: !readiness.embedder.semantic,
    vectorEnabled: readiness.usable,
  });
  const normalized = normalizeName(query);
  const key = normalized.queryKey || normalized.matchKey;
  if (!key) return [];
  const [lexical, fullText] = await Promise.all([
    store.byLexical(key, limit),
    store.byFullText(key, limit),
  ]);
  const seen = new Map<string, (typeof lexical)[number]>();
  for (const hit of [...lexical, ...fullText]) {
    if (!seen.has(hit.candidate.code)) seen.set(hit.candidate.code, hit);
  }
  return [...seen.values()].slice(0, limit).map((h) => h.candidate);
}

export async function lookupCode(code: string) {
  const store = new PostgresCandidateStore(pool);
  return store.byCode(code);
}
