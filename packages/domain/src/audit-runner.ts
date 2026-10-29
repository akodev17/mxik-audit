// Runs the matching pipeline and the five checks across a stored catalogue,
// then persists findings. Server-only.
import { Pool } from 'pg';
import { startHeartbeat } from './audit-heartbeat.js';
import { db } from '@tasnivo/db';
import { runPool } from './work-pool.js';
import { embeddingProviderFromEnv, sharedEmbeddingProvider } from '@tasnivo/core/embed/index';
import { matchProduct, timed, type DisableableStage, type StageTimer } from '@tasnivo/core/match/pipeline';
import { lexicalQuery } from '@tasnivo/core/match/query';
import { NoopRerankProvider, rerankFromEnv } from '@tasnivo/core/match/rerank';
import { PositionStore } from '@tasnivo/core/match/position-store';
import type { DictionaryLookup } from '@tasnivo/core/match/dictionary';
import type { AliasLookup } from '@tasnivo/core/match/alias';
import { loadDictionary } from './dictionary.js';
import { applyLexicon } from './lexicon.js';
import {
  buildPipelineMeta, countMatch, emptyCounters, type ClassifierProvenance, type PipelineMeta, type PipelineSetup,
} from './pipeline-meta.js';
import { PostgresRerankCache } from '@tasnivo/core/match/rerank-cache-pg';
import { rerankConfigFromEnv } from '@tasnivo/core/match/rerank-config';
import { PROMPT_VERSION } from '@tasnivo/core/match/rerank-prompt';
import { lexicalStrictThresholdFromEnv, PostgresCandidateStore } from '@tasnivo/core/match/store';
import { checkVectorReadiness, type VectorColumn, type VectorReadiness } from '@tasnivo/core/match/vector-readiness';
import { normalizeName } from '@tasnivo/core/normalize/index';
import {
  POSITION_DIGITS, readCode, runChecks, type Finding, type ResolvedRow, type Restriction,
} from '@tasnivo/core/audit/checks';
import { markingRequired } from '@tasnivo/core/audit/marking';
import type { RerankGate } from '@tasnivo/core/match/rerank-config';
import type {
  EmbeddingProvider, RerankOutcome, RerankProvider, RerankUsage, ScoredCandidate, VectorOutcome,
} from '@tasnivo/core/match/types';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';

// One pool for the whole server process; the classifier queries are read-only.
const globalForPool = globalThis as unknown as { mxikPool?: Pool };
const pool = globalForPool.mxikPool ?? new Pool({ connectionString: DATABASE_URL, max: 8 });
if (process.env.NODE_ENV !== 'production') globalForPool.mxikPool = pool;

/** The process's classifier pool, for a long-lived process that reuses it (the worker). */
export function classifierPool(): Pool {
  return pool;
}

/** Ends the pool, for a process shutting down. Nothing may query through it afterwards. */
export async function closeClassifierPool(): Promise<void> {
  await pool.end();
  if (globalForPool.mxikPool === pool) delete globalForPool.mxikPool;
}

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
  /** Approved global aliases (lexicon.ts applyLexicon), one more retrieval list. */
  aliases?: AliasLookup | undefined;
  timer?: StageTimer | undefined;
  /** Stage 4 is switched off when the stored vectors are unusable, so no query is embedded. */
  disabledStages?: ReadonlySet<DisableableStage> | undefined;
  /** Vector columns holding the provider's vectors (embedding_state.columns). */
  vectorColumns?: readonly VectorColumn[] | undefined;
  /** Providers as configured for this run, for Catalog.pipelineMeta. */
  setup?: PipelineSetup | undefined;
  degradedReasons: string[];
  /** restricted_code: generalized codes EHF refuses, with the date. Absent = no RESTRICTED check. */
  restricted?: ReadonlyMap<string, Date> | undefined;
};

/** The restricted list, small enough to hold per audit. An unmigrated database has none. */
export async function loadRestricted(): Promise<Map<string, Date>> {
  const rows = await db.restrictedCode.findMany({ select: { code: true, effectiveFrom: true } }).catch(() => []);
  return new Map(rows.map((r) => [r.code, r.effectiveFrom]));
}

/**
 * Where vectorReadiness gets its embedder. `configured` builds the provider the environment asks for;
 * `reuse` may swap the provider readiness settled on (the configured one, or a local one rebuilt from
 * the stored vectors' name) for an equal instance kept from earlier.
 */
export type EmbedderSource = {
  configured(): EmbeddingProvider;
  reuse(embedder: EmbeddingProvider): EmbeddingProvider;
};

/** By default a fresh provider per call, so nothing outlives an audit (the web, scripts, tests). */
const freshEmbedders: EmbedderSource = { configured: () => embeddingProviderFromEnv(), reuse: (embedder) => embedder };
let embedders = freshEmbedders;

/** Installs a long-lived process's embedder source (the worker keeps one model loaded); null restores the default. */
export function useEmbedderSource(source: EmbedderSource | null): void {
  embedders = source ?? freshEmbedders;
}

/** An EmbedderSource that also says which providers it holds (for health checks and tests). */
export type KeptEmbedders = EmbedderSource & { names(): string[] };

/**
 * The source for a long-lived process (the API, the worker): the configured provider is built once
 * per configuration, and the first provider seen under a name is kept for the process's life, so a
 * local model (470 MB of weights) is loaded once instead of once per audit, check or doc check (Q1).
 */
export function keptEmbedders(configured: () => EmbeddingProvider = () => sharedEmbeddingProvider()): KeptEmbedders {
  const byName = new Map<string, EmbeddingProvider>();
  const keep = (embedder: EmbeddingProvider): EmbeddingProvider => {
    const kept = byName.get(embedder.name);
    if (kept) return kept;
    byName.set(embedder.name, embedder);
    return embedder;
  };
  return { configured: () => keep(configured()), reuse: keep, names: () => [...byName.keys()] };
}

/** The vector stage's state for the configured provider, on the shared pool. */
export async function vectorReadiness(): Promise<VectorReadiness> {
  const readiness = await checkVectorReadiness(pool, embedders.configured());
  return { ...readiness, embedder: embedders.reuse(readiness.embedder) };
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
    reranker: { enabled: reranker.available, model: reranker.available ? config.name : null, promptVersion: PROMPT_VERSION },
  };
  const degradedReasons: string[] = [];
  if (!reranker.available) {
    degradedReasons.push('LLM qayta tartiblash oʻchirilgan');
    console.warn(`[audit] reranker off: ${config.disabledReason ?? 'unavailable'}`);
  }
  if (!embedder.semantic) degradedReasons.push('vektor qidiruv toʻliq semantik emas');
  if (!readiness.usable) degradedReasons.push('vektor bosqichi oʻchirilgan');
  const dictionary = await loadDictionary(orgId).catch(() => undefined);
  // The learned lexicon is installed for the normaliser here; the aliases go to the pipeline.
  const aliases = (await applyLexicon()).aliases;
  const disabledStages = readiness.usable ? undefined : new Set<DisableableStage>(['vector']);
  const vectorColumns = readiness.stored?.columns;
  const restricted = await loadRestricted();
  return { store, embedder, reranker, gate, dictionary, aliases, timer, disabledStages, vectorColumns, setup, degradedReasons, restricted };
}

export type AuditableItem = {
  rawName: string;
  barcode: string | null;
  existingMxik: string | null;
  unit: string | null;
  /** TIF TN (TN VED) code; its heading limits retrieval and feeds TNVED_MISMATCH. */
  tnved?: string | null;
};

export type ItemCheck = {
  findings: Finding[];
  markingRequired: boolean;
  /** What stages 4 and 6 did for this row, for the run's pipeline metadata. */
  match: { rerank: RerankOutcome; vector: VectorOutcome };
  /** The ranked suggestions the checks saw (the row's own code included when it was scorable). */
  suggestions: ScoredCandidate[];
  /** What the classifier says about the row's own code. */
  existing: ResolvedRow['existing'];
};

const SUGGESTIONS = 5;
const SELF_MATCH_DEPTH = 20;

/** Matches one row and runs every check on it. Writes nothing. */
export async function checkItem(item: AuditableItem, ctx: AuditContext): Promise<ItemCheck> {
  const { store, embedder, reranker, gate, dictionary, aliases, timer, disabledStages, vectorColumns } = ctx;
  // Ranked deeper than the suggestions so the row's own code is usually
  // scorable from this one retrieval, without a second pass.
  const match = await matchProduct({
    rawName: item.rawName,
    barcode: item.barcode,
    unit: item.unit,
    existingMxik: item.existingMxik,
    tnved: item.tnved ?? null,
  }, { store, embedder, reranker, dictionary, aliases, rerankGate: gate, timer, disabledStages, vectorColumns, topK: SELF_MATCH_DEPTH });

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
        { store, embedder, reranker, rerankGate: gate, disabledStages, vectorColumns, topK: SELF_MATCH_DEPTH },
      ));
      found = selfMatch.candidates.find((s) => s.candidate.code === code);
    }
    if (found) suggestions = [...suggestions, found];
  }

  // The row's own code, or on a MISSING row the code it would be given.
  const restrictedCode = code ?? suggestions[0]?.candidate.code ?? null;
  const effectiveFrom = restrictedCode ? ctx.restricted?.get(restrictedCode) : undefined;
  const restriction: Restriction | null = restrictedCode && effectiveFrom
    ? { code: restrictedCode, effectiveFrom, replacements: await timed(timer, 'restricted', () => replacementsFor(item, restrictedCode, match.candidates, ctx)) }
    : null;

  const findings = runChecks({
    existingMxik: item.existingMxik,
    unit: item.unit,
    existing,
    suggestions,
    vetoed: match.veto !== null,
    restriction,
    tnved: item.tnved ?? null,
  });

  // Marking: the row's own marked code always sets it; a marked suggested code
  // only when it is labelled "Yuqori moslik" or came from barcode/dictionary.
  // A low-confidence guess does not. Rule and reasons in core/audit/marking.
  return {
    findings,
    markingRequired: markingRequired(existing.candidate?.isMarked === true, findings, suggestions),
    match: { rerank: match.rerank, vector: match.vector },
    suggestions,
    existing,
  };
}

const REPLACEMENTS = 5;

/**
 * Detailed codes that can replace a restricted generalized one: the non-base,
 * unrestricted codes of its 8-digit position, best first. The row's own
 * ranking comes first (it had every stage, the reranker included); the normal
 * pipeline then ranks the rest of the position, which retrieval over the whole
 * classifier rarely reaches when the row's name is the generalized code's name.
 */
async function replacementsFor(
  item: AuditableItem, restrictedCode: string, ranked: readonly ScoredCandidate[], ctx: AuditContext,
): Promise<ScoredCandidate[]> {
  const position = restrictedCode.slice(0, POSITION_DIGITS);
  const usable = (c: ScoredCandidate): boolean => c.candidate.code.startsWith(position)
    && !c.candidate.isBase && !(ctx.restricted?.has(c.candidate.code) ?? false);
  const out = ranked.filter(usable).slice(0, REPLACEMENTS);
  const excluded = [...(ctx.restricted?.keys() ?? [])].filter((c) => c.startsWith(position));
  const scoped = new PositionStore(pool, position, excluded);
  if (out.length >= REPLACEMENTS || (await scoped.size()) === 0) return out;
  // No reranker here: the LLM already judged the row once, in the main pass.
  const rest = await matchProduct({ rawName: item.rawName, unit: item.unit }, {
    store: scoped, embedder: ctx.embedder, reranker: new NoopRerankProvider('restricted replacement'),
    disabledStages: SCOPED_OFF, topK: REPLACEMENTS,
  });
  const seen = new Set(out.map((c) => c.candidate.code));
  return [...out, ...rest.candidates.filter((c) => usable(c) && !seen.has(c.candidate.code))].slice(0, REPLACEMENTS);
}

const SCOPED_OFF: ReadonlySet<DisableableStage> = new Set(['barcode', 'vector']);

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
    restrictedMxik: f.restriction?.code ?? null,
    restrictedFrom: f.restriction?.effectiveFrom ?? null,
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
      existingMxik: true, unit: true, tnved: true, markingRequired: true,
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
    // Written both ways, so a re-audit clears a flag an earlier run set.
    if (markingRequired !== item.markingRequired) {
      await db.catalogItem.update({ where: { id: item.id }, data: { markingRequired } });
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

/** The candidate store the "pick another code" search queries, set up as audits set theirs up. */
export async function classifierSearchStore(on: Pool = pool, configured: EmbeddingProvider = embeddingProviderFromEnv()): Promise<PostgresCandidateStore> {
  const readiness = await checkVectorReadiness(on, configured);
  return new PostgresCandidateStore(on, {
    exactVectorScan: !readiness.embedder.semantic,
    vectorEnabled: readiness.usable,
  });
}

/** Lexical and full-text hits for a query, merged by code, best first. */
export async function searchClassifierIn(store: PostgresCandidateStore, query: string, limit = 10) {
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

/** Classifier lookup for the Review screen's "pick another code" box. */
export async function searchClassifier(query: string, limit = 10) {
  return searchClassifierIn(await classifierSearchStore(), query, limit);
}

export async function lookupCode(code: string) {
  const store = new PostgresCandidateStore(pool);
  return store.byCode(code);
}
