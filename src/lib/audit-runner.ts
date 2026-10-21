// Runs the matching pipeline and the five checks across a stored catalogue,
// then persists findings. Server-only.
import { Pool } from 'pg';
import { startHeartbeat } from './audit-heartbeat.js';
import { db } from './db.js';
import { runPool } from './work-pool.js';
import { embeddingProviderFromEnv } from '../core/embed/index.js';
import { matchProduct, timed, type DisableableStage, type StageTimer } from '../core/match/pipeline.js';
import { lexicalQuery } from '../core/match/query.js';
import { rerankFromEnv } from '../core/match/rerank.js';
import type { DictionaryLookup } from '../core/match/dictionary.js';
import { loadDictionary } from './dictionary.js';
import {
  buildPipelineMeta, countMatch, emptyCounters, type ClassifierProvenance, type PipelineMeta, type PipelineSetup,
} from './pipeline-meta.js';
import { PostgresRerankCache } from '../core/match/rerank-cache-pg.js';
import { rerankConfigFromEnv } from '../core/match/rerank-config.js';
import { PROMPT_VERSION } from '../core/match/rerank-prompt.js';
import { lexicalStrictThresholdFromEnv, PostgresCandidateStore } from '../core/match/store.js';
import { checkVectorReadiness, type VectorReadiness } from '../core/match/vector-readiness.js';
import { normalizeName } from '../core/normalize/index.js';
import { readCode, runChecks, type Finding, type ResolvedRow } from '../core/audit/checks.js';
import type { RerankGate } from '../core/match/rerank-config.js';
import type {
  EmbeddingProvider, RerankOutcome, RerankProvider, RerankUsage, ScoredCandidate, VectorOutcome,
} from '../core/match/types.js';

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
  /** Operator-facing text, for logs and scripts. The stable codes are in pipelineMeta. */
  degradedReasons: string[];
  /** Null when the reranker was off for this run. */
  llm: RerankUsage | null;
  /** What was stored on Catalog.pipelineMeta for this run. */
  pipelineMeta: PipelineMeta;
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
  /** The org's firm dictionary, checked before the cascade. */
  dictionary?: DictionaryLookup | undefined;
  timer?: StageTimer | undefined;
  /** Stage 4 is switched off when the stored vectors are unusable, so no query is embedded. */
  disabledStages?: ReadonlySet<DisableableStage> | undefined;
  /** Providers as configured for this run, for Catalog.pipelineMeta. */
  setup?: PipelineSetup | undefined;
  degradedReasons: string[];
};

/** The vector stage's state for the configured provider, on the shared pool. */
export async function vectorReadiness(): Promise<VectorReadiness> {
  return checkVectorReadiness(pool, embeddingProviderFromEnv());
}

/** Builds the matching setup for one org; cached LLM verdicts never cross orgs. */
export async function auditContext(orgId: string, timer?: StageTimer): Promise<AuditContext & { setup: PipelineSetup }> {
  const config = rerankConfigFromEnv(process.env);
  const cache = new PostgresRerankCache(pool, orgId, config.model);
  const { reranker, gate } = rerankFromEnv(process.env, cache);
  const readiness = await vectorReadiness();
  const embedder = readiness.embedder;
  const store = new PostgresCandidateStore(pool, {
    exactVectorScan: !embedder.semantic,
    vectorEnabled: readiness.usable,
    lexicalStrictThreshold: lexicalStrictThresholdFromEnv(process.env),
  });
  const setup: PipelineSetup = {
    embedder: { name: embedder.name, semantic: embedder.semantic },
    vectorUsable: readiness.usable,
    reranker: { enabled: reranker.available, model: reranker.available ? config.model : null, promptVersion: PROMPT_VERSION },
  };
  const degradedReasons: string[] = [];
  if (!reranker.available) {
    degradedReasons.push('LLM qayta tartiblash oʻchirilgan');
    console.warn(`[audit] reranker off: ${config.disabledReason ?? 'unavailable'}`);
  }
  if (!embedder.semantic) degradedReasons.push('vektor qidiruv toʻliq semantik emas');
  if (!readiness.usable) degradedReasons.push('vektor bosqichi oʻchirilgan');
  const dictionary = await loadDictionary(orgId).catch(() => undefined);
  const disabledStages = readiness.usable ? undefined : new Set<DisableableStage>(['vector']);
  return { store, embedder, reranker, gate, dictionary, timer, disabledStages, setup, degradedReasons };
}

export type AuditableItem = {
  rawName: string;
  barcode: string | null;
  existingMxik: string | null;
  unit: string | null;
};

export type ItemCheck = {
  findings: Finding[];
  markingRequired: boolean;
  /** What stages 4 and 6 did for this row, for the run's pipeline metadata. */
  match: { rerank: RerankOutcome; vector: VectorOutcome };
};

const SUGGESTIONS = 5;
const SELF_MATCH_DEPTH = 20;

/** Matches one row and runs every check on it. Writes nothing. */
export async function checkItem(item: AuditableItem, ctx: AuditContext): Promise<ItemCheck> {
  const { store, embedder, reranker, gate, dictionary, timer, disabledStages } = ctx;
  // Ranked deeper than the suggestions so the row's own code is usually
  // scorable from this one retrieval, without a second pass.
  const match = await matchProduct({
    rawName: item.rawName,
    barcode: item.barcode,
    unit: item.unit,
    existingMxik: item.existingMxik,
  }, { store, embedder, reranker, dictionary, rerankGate: gate, timer, disabledStages, topK: SELF_MATCH_DEPTH });

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
        { store, embedder, reranker, rerankGate: gate, disabledStages, topK: SELF_MATCH_DEPTH },
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
    vetoed: match.veto !== null,
  });

  // Marking follows the classifier's own flag on the row's code or on a code we suggest.
  const suggestedMarked = findings.some((f) =>
    suggestions.find((s) => s.candidate.code === f.suggestedMxik)?.candidate.isMarked === true);
  return {
    findings,
    markingRequired: existing.candidate?.isMarked === true || suggestedMarked,
    match: { rerank: match.rerank, vector: match.vector },
  };
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

/** The classifier snapshot an audit runs against: set when it starts, kept when it resumes. */
async function recordSnapshot(catalogId: string, current: number | null, fromRow: number): Promise<ClassifierProvenance> {
  const snapshot = fromRow > 0 && current !== null
    ? await db.catalogSnapshot.findUnique({ where: { id: current }, select: { id: true, takenAt: true } })
    : await db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true, takenAt: true } });
  if (snapshot && snapshot.id !== current) await db.catalog.update({ where: { id: catalogId }, data: { snapshotId: snapshot.id } });
  return { snapshotId: snapshot?.id ?? null, takenAt: snapshot?.takenAt.toISOString() ?? null };
}

async function auditRows(catalogId: string, options: AuditOptions): Promise<AuditOutcome> {
  const { fromRow = 0, onProgress, timer } = options;
  const catalogOrg = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true, snapshotId: true } });
  if (!catalogOrg) throw new Error(`no catalogue ${catalogId}`);
  const classifier = await recordSnapshot(catalogId, catalogOrg.snapshotId, fromRow);
  const ctx = await auditContext(catalogOrg.orgId, timer);
  ctx.setup.classifier = classifier;
  const { degradedReasons, reranker } = ctx;
  const counters = emptyCounters();
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
    const { findings, markingRequired, match } = await checkItem(item, ctx);
    countMatch(counters, match);
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

  const pipelineMeta = buildPipelineMeta(ctx.setup, counters, fromRow, new Date());
  await db.catalog.update({ where: { id: catalogId }, data: { pipelineMeta } });
  return {
    itemsAudited: items.length,
    findingsCreated,
    degraded: degradedReasons.length > 0 || pipelineMeta.degradedReasons.length > 0,
    degradedReasons,
    llm: reranker.usage?.() ?? null,
    pipelineMeta,
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
  const key = lexicalQuery(normalized.queryKey || normalized.matchKey);
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
