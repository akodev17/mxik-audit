# MXIK matching engine: engineering plan

Written 2026-10-21 from the repository as it is, not from the docs' claims.
Every number below was either measured in this investigation or copied from a
file that records how it was measured. Items marked **(unverified)** could not
be confirmed and must be re-measured before they are relied on.

This plan improves the existing engine in `src/core/match`, `src/core/normalize`,
`src/core/audit` and `scripts/`. It does not replace the pipeline, the schema or
the application. The implementer works in an existing worktree branch that
already carries the first fixes (see §0), reads this file first, and reports
against the baselines in §7.

---

## 0. Starting state and what must be preserved before anything else

| Item | State on 2026-10-21 |
|---|---|
| `main` (local) | `2c5312d`, 5 commits ahead of `origin/main` (`e39d80c`); another session is committing landing/design work on it right now and has staged changes in the index. **Do not commit on main from the implementation session.** |
| `claude/matching-quality-661c2d` | `6b02185`, cut from `e39d80c`, worktree at `.claude/worktrees/matching-quality-661c2d`. Carries the first real-data fixes (abbreviations, fragment guard, size-aware duplicates, `eval/real-metal.csv`). Merges cleanly into main. **The implementation branch is cut from this branch.** |
| Uncommitted in the main checkout | `docs/PRODUCTION_PLAN.md`, `docs/engineering/` (this plan), plus the other session's `next.config.ts`, `src/app/styleguide/`, deleted `src/app/(app)/dev/ui`. None of it belongs to this task. |
| Local database | Docker `mxik-audit-db`, Postgres 16 + pgvector, host port 54329. Shared with the running dev server on port 3000. **No migrations against it, no `load:db`, no `embed:catalog` from the implementation session** unless §9 phase 0 is explicitly run by the owner. |
| Classifier in the DB | 438,925 codes, snapshot taken 2026-08-20 (`catalog_snapshot` rows 1 and 2, source `data/mxik.ndjson`). 6,985 base codes, 191,636 with a barcode, 385,414 with a strict unit binding. |
| Vectors in the DB | `embedding_state.provider = "hashing (local, non-semantic)"`, 384 dims, updated 2026-08-20. `data/models/` is empty: the local e5 weights are not on this machine. |
| `data/` | `classifier_*.xlsx` and `mxik.ndjson` dated 2026-08-20; `ingest-manifest.json` and `units.json` dated 2026-10-16. |

**Verified discrepancy, the most important fact in this plan.** `docs/SESSION_STATE.md`
and `docs/eval-results.json` record runs on 2026-10-15/16 against a 442,719-code
classifier with `local:Xenova/multilingual-e5-small` vectors (eval runs "P1.1",
"P1.2", "P1 end of block"; perf run "300 rows … e5"). The Docker volume
`mxik-audit_mxik-pgdata` was created 2026-10-16 05:49, yet its contents are the
August snapshot with hashing vectors, and `data/` holds the August export. So the
October data layer (new export, e5 vectors, model weights) no longer exists on
this machine. Everything measured today runs in the degraded configuration the
docs describe as "reverted". Numbers from October cannot be compared with numbers
from today until phase 0 rebuilds the data layer. The engine code itself is the
October code; only the data drifted.

---

## 1. Current architecture and verified problems

### 1.1 The pipeline as implemented (`src/core/match/pipeline.ts`)

```
row name ─► normalizeName (src/core/normalize/index.ts)
  stage 0  firm dictionary (FirmMapping: barcode or folded name + unit)      → certain, no LLM
  stage 1  barcode = GTIN  → store.byBarcode                                 → confidence 1.00
  stage 2  folded exact    → store.byMatchKey(matchKey, sortedKey, literalKeys) → 0.95
  stage 3  lexical: trigram word_similarity(query, searchText) ‖ full-text ts_rank_cd on searchVector
  stage 4  vector: cosine over embeddingUz (HNSW), guarded by vector-readiness.ts
  stage 5  reciprocal rank fusion (k=60) of lexical, fullText, vector → top rerankLimit
           rules.ts adjustments (base-code preference, marking, prepared dish, strict unit)
  stage 6  Claude reranker on uncertain rows (rerank-gate: minConfidence 0.95, minMargin 0.10)
  calibration: score.ts weights lexical 0.45 / vector 0.25 / rrf 0.30, margin 0.15,
               LLM 0.40, NO_RERANK_CEILING 0.85; bands high ≥0.90, medium ≥0.60
  relevance.ts: hide candidates < 0.75 that share no word with the product
  checks.ts: MISSING | NOT_FOUND (retired → wasRetired) | MISMATCH (self-score < 0.6) | UNIT_CONFLICT | NOT_PURCHASED
```

Retrieval data per code (`mxik_code`): `matchKeys` (every folded spelling of the
three names, GIN), `searchText` = folded `nameUz + nameRu` only (trigram GIN),
`searchVector` tsvector 'simple' (GIN), `embeddingUz` (HNSW, m=16, ef=64),
hierarchy names in three languages, unit binding, barcode, `isBase`, `isMarked`,
`taxPrivilegeIds`. Built by `scripts/lib/load-classifier.ts`.

### 1.2 Problems verified in this investigation

| # | Problem | Evidence | Where |
|---|---|---|---|
| P1 | Two-letter fragments decide full-text matches | "Труба ГД б/ш 32х3,0" → cement "SEM II/B-Sh" with `matchedWords: ["sh"]`; 22 rows | fixed on branch: `src/core/match/query.ts`, `evidence.ts` |
| P2 | Trade abbreviations not expanded | б/ш, г/к, х/к, эл/св, ВГП, ГД/ХД; classifier spells them out (бесшовные 4,806 names) | fixed on branch: `src/core/normalize/abbreviations.ts` |
| P3 | Duplicate diagnostic drops sizes | 115 false duplicates in 168 rows | fixed on branch: `src/lib/import-diagnostics.ts` + `attrsKey` |
| P4 | `relevance.ts` still counts 2-letter words as shared meaning | `words()` keeps `length >= 2` | open |
| P5 | Rebar unreachable: "Арматура" vs classifier "Прокат арматурный"; full-text cannot bridge, prefix search swamped by plastic fittings (03917) | branch report; 2 rows still outside 072/073 | open, needs synonyms or hierarchy-aware ranking |
| P6 | "Лист г/к" lands in the stainless position 07219001001000007 whose name is literally "Лист горячекатаный"; hierarchy (group "нержавеющая") is ignored by lexical ranking | branch report | open |
| P7 | `searchText` holds only the two leaf names: hierarchy words (group/class/position) never reach trigram or full-text, although the reranker prompt says "the hierarchy path matters more than surface similarity" | `load-classifier.ts:178` | open |
| P8 | Lexical stage is the latency bottleneck: 2.4 s/row trigram + 1.15 s/row full-text at concurrency 8; 2.4 rows/s end to end (perf run 2026-10-15, e5). The planned 60,000-row perf run was never recorded | `docs/perf-results.json`, `audit-runner.ts:257` | open |
| P9 | Semantic retrieval is off on this machine (hashing vectors). With hashing, the vector stage *hurts* on the metal set: full 44.0% vs vector-off 73.8% top-1 after the branch fixes | branch eval | data, phase 0 |
| P10 | Reranker has never run with a real key; gate thresholds (0.95/0.10) were set from dry runs | `eval-results.json` providers, `.env` | open, phase 4 |
| P11 | No restricted-code check: 423 construction codes restricted in EHF from 1 July 2026 audit as "no risk" | today's upload | out of scope here, see `docs/PRODUCTION_PLAN.md` item 2 |
| P12 | Golden set is 12 hand-written rows; synthetic set derives from classifier names and overestimates (92.7% top-1). The only customer-shaped data is `eval/real-metal.csv` (168 rows, one product family) | `eval/` | phase 1 |
| P13 | Saved `FirmMapping` keys and `groupKey`s computed before the abbreviation expansion will no longer match names that now normalise differently (25 firm mappings exist locally, all demo data) | branch report | migration note, §12 |
| P14 | Upload page shows "Tahlil navbatda…" while the audit runs (DB said analyzing 141/168) | `src/app/(app)/upload/processing-step.tsx:92`, `/upload/progress` | UI, not engine; leave to `docs/PRODUCTION_PLAN.md` item 5 |

---

## 2. Existing components that must be preserved

- The six-stage cascade and its contracts: `MatchInput`, `MatchResult`,
  `ScoredCandidate`, `Signals`, `MatchEvidence` (`types.ts`, `evidence.ts`).
  Findings store `alternatives` and `evidence` as JSON; stored rows must still
  parse (`parseEvidence`).
- Confidence semantics in `docs/scoring.md`: bands, the no-reranker ceiling
  (0.85), the rule that a skipped or failed LLM call never lifts a cap, and the
  server-side bulk-accept floor of 0.90 (`src/lib/bulk.ts`). Labels in
  `confidence-labels.ts` are the only place a label is decided.
- `vector-readiness.ts`: the guard against comparing query vectors from one
  model with stored vectors from another. Any embedding change goes through
  `embedding_state` and the `rebuilding:` prefix.
- Public API contract `src/lib/api/contract.ts`, `openapi.ts`, `v1/check`,
  `v1/catalogs`: response shapes, error codes, `FINDING_FIELDS`. Covered by
  `routes.test.ts`, `openapi.test.ts`.
- `checks.ts` finding types and severities; `MISMATCH_THRESHOLD = 0.6`; the
  rule that a code is raised as MISMATCH only when the suggestion sits in a
  different 8-digit position (owner-approved, commit `faa1c3d`).
- The firm dictionary (`dictionary.ts`, `FirmMapping`) as stage 0 with no LLM
  call, and the barcode-over-name conflict handling.
- Eval harness `eval/run.ts` with its append-only `docs/eval-results.json`,
  per-set reporting (`real`, `synthetic`, `real-metal`, …), and stage ablation
  configs. New metrics are added, existing keys keep their meaning.
- Audit runner behaviour: background jobs, heartbeat, resume from watermark,
  concurrency 8, `pipelineMeta.degradedReasons`.
- Prisma migrations are `migrate deploy` only (README). Schema changes in this
  plan are additive.

---

## 3. Proposed matching pipeline and ranking improvements

Ordered by expected gain per unit of risk. Each item is independently
measurable with `npm run eval`.

### 3.1 Hierarchy-aware lexical retrieval (addresses P6, P7, P5 partly)

Today `searchVector` is built from the same two leaf names as `searchText`.
Add a **weighted tsvector**: leaf names weight A, subposition + position names
weight B, class + group names weight C, brand/attribute names weight D, in all
three languages (folded with `matchKeyOf`, Latin and Cyrillic alternates via
`scriptAlternates`). `ts_rank_cd` then rewards a query word that hits the
position name ("прокат горячекатаный") even when the leaf name does not contain
it, and a candidate whose *group* contradicts the query ("нержавеющая" for a
plain "лист г/к") stops tying with the right one.

- Schema: additive migration `searchVectorWeighted tsvector` + GIN index, filled
  by `load-classifier.ts`; keep the old column until the eval shows the new one
  wins, then switch `store.byFullText` and drop the old one in a later
  migration. The trigram `searchText` stays leaf-only (the git history records
  that more text diluted word_similarity).
- Store: `byFullText` ranks on the weighted vector; the "selecting terms" cutoff
  (terms in > 10,000 codes rank but do not select) keeps working.
- Evidence: `matchedWords` reports hierarchy hits separately
  (`matchedHierarchyWords`) so a reviewer sees *why* a position was chosen.

> **Implementation note (2026-10-21, phase 2.3).** Built as planned, with
> three adaptations. (1) The column cannot be `GENERATED` like `searchVector`
> because the folding is TypeScript, so it is a plain column filled by
> `load:db` and by a new resumable `npm run search:weighted` backfill (223 s
> for 438,925 rows on the scratch copy; GIN index 53 MB, built
> `CONCURRENTLY` in 10 s after the fill). The migration only adds the column;
> the store treats a valid index as "filled". Verified: the migration on
> `mxik_scratch` (5.7 s) and on an empty database, `load:db` on 3,000 real
> records producing byte-identical `searchText` and vectors to the backfill.
> (2) `scriptAlternates` is not applied: it rewrites every "s" in a string,
> right for exact keys but a junk lexeme per word in a tsvector, and the
> miss diagnostic shows no ц misses. (3) Weights: A = 0.1 (exactly the plain
> column's weight, so `FULLTEXT_K` keeps its meaning and a leaf-only hit
> ranks identically, tested), B 0.05, C 0.025, D 0.0125; only leaf (A) words
> select candidates. **Result: no case moved** (runs 23 vs 25, identical
> predictions on all 473 cases); letting position words select too (A+B,
> run 24) made two synthetic cases worse. The decisive words of these rows
> are already in the leaf names; the hierarchy only reorders codes that tie
> inside one position, which §3.2 addresses directly. Following this
> section's own rule ("keep the old column until the eval shows the new one
> wins"), the weighted column is **opt-in** (`fullTextColumn: 'weighted'`,
> `npm run eval -- --fulltext-column weighted`); the default stays
> `searchVector`. The evidence field and its UI line work when it is on.
> Re-measure with e5 vectors after phase 0 before switching.

### 3.2 Position-level fusion (addresses P5, P6)

Candidates are fused per code. 150 near-identical identifying codes under one
position (sizes, grades) each get a rank, so the right *position* is split across
them while a wrong position with one base code wins RRF. Add a second fusion
pass keyed on `subPositionCode` (or 8-digit `positionCode`): the position whose
codes are most represented in the top lists gets a bonus that is spread to its
base code first. Implement in `fusion.ts` as a pure function with tests; expose
the position rank in `Signals` (`positionRrf`) and give it a small weight in
`score.ts` (start 0.10, taken from `rrf`), re-measured on all eval sets.

> **Implementation note (2026-10-21, phase 3).** Implemented as planned
> (`groupFusion`, `Signals.positionRrf`, keys subposition or 8-digit
> position), plus a per-list cap and the rule that a non-semantic stand-in
> does not vote. "Spread to its base code first" was not added: the base
> code of a position already carries the +0.05 base rule, and injecting a
> base code retrieval never found would give it a score from the position
> signal alone. Measured (exploratory runs 30–32, fits 1–3 in
> `docs/weight-fit-results.json`): it fixes the metal set (14 profile pipes
> leave 07216001015; top-1 46 → 76, up to 98 with the stand-in out of the
> scoring) but every variant breaks §7.3 on synthetic (−4 to −10 points)
> and on the hold-out loses golden rows (hold-out objective 74.6–75.0 vs
> 84.9 baseline). It is therefore **opt-in** (`positionFusion`), weight
> 0.20 when on, `rrf` keeps 0.30. Re-measure with e5 vectors (phase 0).

### 3.3 Synonym and term table for the classifier's own vocabulary (addresses P5)

The abbreviation table expands what the *customer* writes. A second, smaller
table maps customer words to the classifier's term when they are different
words, not abbreviations: арматура (metal context) → "прокат арматурный",
уголок → "уголки", швеллер → "швеллеры", сетка кладочная → "сетка сварная",
кирпич → "кирпичи керамические", etc. Keep it data-driven
(`src/core/normalize/synonyms.ts`), applied to the *lexical query only* (never
to the display name or match keys), and gated by context words where a term is
ambiguous ("арматура" with труба/фитинг nearby stays as is). Every entry needs a
test and a DB count comment like the abbreviation table has.

> **Implementation note (2026-10-21, phase 2.2).** Eight entries, each from a
> miss in the phase 1 diagnostic and with its live-name count: арматура →
> прокат арматурный (*replaces* the word, gated off by 30 pipe/valve/fitting/
> plastic stems, because 9,270 of 9,892 "арматур" names are fittings),
> уголок, минвата (replace), утеплитель, газоблок, пеноблок, керамзитоблок,
> ПП/PPR → полипропиленовые (kept here rather than in abbreviations.ts so
> match keys do not change). The plan's "уголок → уголки" was wrong in
> practice: "уголки" pulled "Уголок 90,100,125" to a PVC corner (run 20);
> the entry uses the classifier's own wording "угловые профили / сталь
> угловая" instead (run 21). "кирпич → кирпичи керамические" was not
> added: it would turn every silicate brick ceramic. The relevance guard
> also counts the synonym's words, or "Минвата" lost "Минеральная вата" to
> the unrelated-filter. Result (run 22 vs 19): construction 67.6/82.4 →
> 75.5/88.2, metal 44.0/74.4 → 45.8/75.6, metal vector-off 73.8/96.4 →
> 75.6/98.2, golden and synthetic unchanged, 12 rows better, none worse.

### 3.4 Relevance guard consistency (addresses P4)

`relevance.ts` `words()` must use the same `MIN_QUERY_WORD` (3) as `query.ts`,
and `sharesMeaning` must also look at the expanded tokens
(`normalizeName(...).tokens`) so a candidate matched through "бесшовные" is not
hidden as "unrelated" to "б/ш". Tests for both directions.

> **Implementation note (2026-10-21, phase 2.1).** Done (`ef6d3ec`).
> `normalizeName().core` was already the expanded text, so the second half
> held before; it is now explicit and tested. No eval case moved (run 19 vs
> 18; the one flip is the documented tie `synthetic.csv:4`).

### 3.5 Unit-aware ranking for per-tonne / per-metre rows

Plastic fittings bound to pieces should lose against steel bound to tonnes when
the row unit is тонна. `rules.ts` already has a strict-unit conflict adjustment;
extend it so a *recommended* unit match earns a small positive adjustment and a
container mismatch (kg vs tonna is compatible; dona vs tonna is not) a negative
one. Pure, tested, measured.

> **Implementation note (2026-10-21, phase 2.4).** The data differ from the
> premise: plastic fittings (03917001) are mostly *strict* {dona}, and so are
> most steel pipe codes (07306001: 13,918 strict {metr}), so both already
> take the −0.15 strict conflict on a per-tonne row; only 4,223 codes have a
> recommended binding. The strict rule is left alone (it drives
> UNIT_CONFLICT findings). New, for recommended bindings only, with a
> quantity-kind map over the 90 official units (`quantityKind` in
> units.ts): `recommendedUnitMatch` +0.03, `unitKindMismatch` −0.05.
> First version also penalised rows sold in pieces and lost "Плинтус ПВХ …
> шт" against a plinth recommended in metres (run 27); a piece can hold any
> quantity, so only a measured row unit (mass, length, area, volume) can
> contradict now. Result (run 28 vs 26): no row worse, construction
> vector-off top-1 75.5 → 76.5, and five top-1 picks move to a more
> specific code of the same subposition (e.g. "в бухтах" → "в мотках").

### 3.6 Calibration re-fit after 3.1–3.5

Weights in `score.ts` were tuned on 12 + 191 cases with hashing vectors. After
the retrieval changes, re-fit on all sets with vectors **on (e5)** and **off**,
keeping `docs/scoring.md` in step. The acceptance rule is in §7: high-band
precision stays 100% on every set; nothing else is allowed to buy top-1.

> **Implementation note (2026-10-21, phase 3).** e5 is not on this machine,
> so the fit ran with the stand-in the audit actually uses here
> (`npm run eval:fit`, new: grid search over memoised retrieval, fixed 20%
> hold-out per set from `eval/split.ts`, constraints from §7.3, history in
> `docs/weight-fit-results.json`). Without a reranker the 0.85 ceiling keeps
> fusion out of the high band, so weights cannot move high-band precision.
> Result: no weight change survives the hold-out; the committed weights
> stay. Repeat `npm run eval:fit` after phase 0.

### 3.7 Reranker: measure before tuning (addresses P10)

Phase 4 only, with a real key: run `eval` with `ANTHROPIC_API_KEY` on all sets,
record cost per row from `rerank-usage.ts`, then tune the gate
(`minConfidence`, `minMargin`) to the point where high-band coverage rises
without high-band precision dropping. Batched rerank (`rerank-batched.ts`) and
`RerankCache` exist; verify the cache key includes `PROMPT_VERSION` and the
classifier snapshot id.

Not proposed: replacing Postgres retrieval with an external search engine,
training a custom model, or changing the band thresholds. There is no evidence
yet that would justify any of them.

---

## 4. MXIK catalogue ingestion and data-quality strategy

The ingestion chain is `fetch:catalog → ingest [--enrich] → load:db → embed:catalog`,
wrapped end to end by `scripts/update-classifier.ts` (`npm run classifier:update`,
advisory lock, diff into `classifier_change`, re-check of client catalogues,
notifications; HTTP trigger `POST /api/cron/classifier-update` with `CRON_SECRET`).

What this plan adds or fixes:

1. **Reproducible data layer (phase 0).** A documented, scripted path from an
   empty volume to "current export + e5 vectors": `classifier:update` once, then
   `embed:catalog` with `LOCAL_EMBEDDING_MODEL` and the weights fetched into
   `data/models` (DEPLOY.md already lists the one-time outbound call to
   huggingface.co). Record the resulting `catalog_snapshot` id and
   `embedding_state` in `docs/SESSION_STATE.md`. Without this, no eval number is
   comparable across machines.
2. **Snapshot provenance in every result.** `pipelineMeta` already stores
   embedder and reranker; add `classifierSnapshotId` and `classifierTakenAt`.
   `eval-results.json` runs record the same two fields. The report already shows
   the version date.
3. **Weighted search vector built at load (3.1)**, from all three languages and
   the hierarchy names; `scriptAlternates` applied so ц/ts and апostrophe
   variants are indexed once.
4. **Data-quality checks in `load:db`** that fail the run loudly instead of
   loading silently: codes not 17 digits, names empty in all three languages,
   `unitBinding = strict` with no resolvable unit (today counted as
   `unitsUnresolved`, only logged), duplicate codes across the three exports,
   a drop of more than 2% in live codes against the previous snapshot (an export
   that lost a sheet must not retire 10,000 codes).
5. **Stale-copy signalling.** `/api/health` reports `classifier.takenAt` and
   age in days; the report and workspace show a banner when the snapshot is
   older than 7 days or the last update failed (`classifier_change` has the
   timestamps). This belongs to `docs/PRODUCTION_PLAN.md` item 3 but the health
   field is cheap and lands here.
6. **Restricted codes** (P11) are a separate table and check; out of scope for
   this plan, listed so the implementer does not fold them into retrieval.

---

## 5. Normalisation, multilingual search, synonyms, semantic retrieval

- **Normalisation order** stays: apostrophes → noise strip (attrs) → abbreviation
  expansion → script detection → Latin/Cyrillic → fold → tokens. New: synonyms
  (3.3) applied to a *copy* used for the lexical query, so `matchKey`,
  `display`, dictionary keys and group keys never change because of a synonym.
- **Scripts.** Queries are folded to Latin; the classifier keys index Latin,
  Cyrillic-Uzbek and Russian folded forms. Keep. The branch's Cyrillic-х
  dimension parsing ("15х2,5") is kept and extended to "×" and "*", with tests.
- **Multilingual full-text.** Postgres has no Uzbek or Russian stemmer in the
  'simple' config; do not add snowball russian blindly (Uzbek Latin would be
  mangled). Instead the weighted vector (3.1) plus `scriptAlternates` plus the
  synonym table give the recall that stemming would. Re-evaluate stemming only
  if the eval shows inflection misses (log them: `eval/run.ts` can print the
  query tokens next to the correct code's tokens for every top-5 miss).
- **Semantic retrieval.** The e5-small local model is the chosen provider
  (free, multilingual, 384 dims, ~2.7 h one-off on 4 threads). Phase 0 restores
  it. Query text for embedding: the *expanded* display name plus the unit, not
  the folded key (e5 is trained on natural text). Verify that `embed-catalog.ts`
  and the per-row query use the same text shape (`embeddingText()` as one shared
  function with a test), otherwise vectors and queries live in different
  distributions.
- **Hashing fallback.** Keep as the stand-in, but when `embedder.semantic` is
  false the vector list enters fusion with a lower weight or not at all: the
  branch eval shows hashing vectors *lower* top-1 on real data by ~30 points.
  Implement as: `WEIGHTS.vector` applies only to semantic providers; a
  non-semantic vector list is excluded from RRF (note in `notes[]`, reported in
  `degradedReasons`). Measure on all sets with vectors on and off.

  > **Implementation note (2026-10-21, phase 3).** Implemented as an option,
  > `nonSemanticVectorWeight` (stand-in enters RRF at that weight and never
  > as a score; 0 skips the stage and its 1.7 s exact scan), with a note in
  > `notes[]`; `degradedReasons` already reports `vector_not_semantic`.
  > Measured in fit 1 at 1, 0.5, 0.25 and 0: **every variant loses golden
  > rows** (golden top-1 75.0 with the stand-in, 50.0 without, run 29) and
  > drops synthetic, while the metal set gains ~30 points. The premise held
  > for real data only; on golden and synthetic the stand-in is the strongest
  > signal. The default therefore stays "counts like a model"; the §7.3
  > criterion "vectors-on never worse than vectors-off by more than 2 points"
  > is **not met** on real-metal in degraded mode (45.8 vs 75.6, run 29) and
  > can only be re-judged with e5 vectors.

---

## 6. Audit validation and human-review behaviour

Unchanged in principle: nothing is written to a customer's catalogue without a
decision; bulk accept only ≥ 0.90 and only for suggestion-type checks; every
decision is an `AuditEvent`; undo reverts one event.

Changes that follow from the engine work:

- **Evidence stays explainable.** `matchedWords` ≥ 3 letters (branch), plus
  `matchedHierarchyWords` (3.1) and `synonymApplied` (3.3) so the reviewer sees
  "арматура → прокат арматурный" in the reason, not a surprise.
- **MISMATCH after expansion.** A row whose existing code was chosen under the
  old normalisation must not flip to MISMATCH only because the self-score moved
  across 0.6 after this change. Phase 3 re-audits the demo catalogues and the
  two real files, diffs finding types against the previous run
  (`versions.ts` carry-over), and the plan is to treat any new MISMATCH caused by
  normalisation alone as a regression to fix, not a finding to ship.
- **Feedback loop.** `SuggestionFeedback` (reasons `other_category`,
  `service_goods`, `finished_raw`, `unit`, `other`) exists but feeds nothing.
  Phase 3 adds an export script `npm run eval:feedback` that turns rejected
  suggestions with a chosen code into eval rows (`eval/real-feedback.csv`,
  org-anonymised: name, unit, chosen code), so the golden set grows from real
  decisions. No model learns from it automatically.
- **Human review of the dictionary.** `dictAutoAccept` (org setting) auto-applies
  dictionary hits; keep, but after the normalisation change run the dictionary
  rekey in §12 so existing mappings keep matching.

---

## 7. Evaluation dataset and measurable success criteria

### 7.1 Sets

| Set | Rows | Source | Status |
|---|---|---|---|
| `eval/golden.csv` | 12 | hand-written seed cases | exists |
| `eval/synthetic.csv` | 191 | classifier names + seeded noise | exists, optimistic |
| `eval/real-metal.csv` | 168 | Uzmetallsavdo price list, labelled by 8-digit position (`07306001*` form) | on the branch |
| `eval/real-construction.csv` | to add, ≥ 60 rows | names from the 423-code restricted list *re-written the way a seller writes them* (short names, sizes, Russian/Uzbek mix) with the official code as label | phase 1 |
| `eval/real-feedback.csv` | grows | from `SuggestionFeedback` (6) | phase 3 |

Labels may list several defensible codes or a position prefix; the metric
counts a hit on any of them (`eval/cases.ts`, `metrics.ts` already support
prefix labels since the branch).

> **Implementation note (2026-10-21, phase 1).** `eval/real-construction.csv`
> has 102 rows, one or more per restricted base code, written by the
> implementer in seller style (Russian, Uzbek Latin, sizes, trade
> abbreviations; e.g. "Пеноблок D600 600х300х200", "Montaj ko'pigi 750 ml").
> They are not customer data and every row's notes say so. Labels are the
> list's official code **plus its 11-digit subposition prefix**
> (`06810008003000000|06810008003*`), not the 8-digit position: the
> restricted base code is exactly what sellers must replace with an
> identifying code of the same subposition, so both are right, while the
> 8-digit position (e.g. `06810006*`, every reinforced-concrete product)
> would accept wrong answers. Where two list codes are equally defensible
> both are listed. One label was widened after the baseline (run 16):
> "Газоблок D500" also accepts `06810999038000000`, a base code named
> exactly "Газоблок" that the exact stage found; run 17 is the corrected
> baseline. The metal set keeps its 8-digit labels.

### 7.2 Baselines (reproducible with `npm run eval` on the stated data)

Degraded configuration (hashing vectors, no reranker, 438,925-code snapshot of
2026-08-20), from `docs/eval-results.json` on the branch:

| Set | Config | Before branch (`e39d80c`) | After branch (`6b02185`) |
|---|---|---|---|
| golden (12) | full | 66.7 / 83.3 | 75.0 / 83.3 |
| synthetic (191) | full | 92.7 / 96.3 | 92.7 / 96.3 |
| real-metal (168) | full | 33.9 / 48.2 | 44.0 / 74.4 |
| real-metal (168) | vector off | 34.5 / 47.6 | 73.8 / 96.4 |

(top-1 / top-5, percent.) High-band precision 100% on every set in every run.
October numbers with e5 vectors (golden 66.7 / 83.3, synthetic 77.5 / 89.0 on
the 442,719 snapshot) are **(unverified)** on this machine until phase 0.

Latency baseline: 2.4 rows/s at concurrency 8 (300-row perf run, e5, 2026-10-15,
i5-14400F); today's degraded audit: 168 rows in ~70 s (2.4 rows/s), 423 rows
with existing codes in ~20 s.

### 7.3 Success criteria for this plan (all measured on the phase-0 data layer)

| Criterion | Target |
|---|---|
| real-metal top-1 / top-5, vectors on | ≥ 80 / ≥ 95 |
| real-metal rows with top-1 outside groups 072/073 | 0 for pipe, sheet, rebar, channel, angle |
| real-construction top-1 / top-5 | ≥ 70 / ≥ 90 |
| golden top-1 / top-5 | no row regresses; top-5 ≥ 83.3 |
| synthetic top-1 / top-5 | ≥ 90 / ≥ 95 (no regression beyond 1 point) |
| high-band precision | 100% on every set, every config |
| hashing vectors on vs off | vectors-on is never worse than vectors-off by more than 2 points on any set (5.5) |
| audit throughput | ≥ 5 rows/s at concurrency 8 on the perf machine; lexical stage ≤ 800 ms/row p50 |
| 60,000-row perf run | recorded in `docs/perf-results.json` |
| tests | `npm run typecheck && npm run lint && npm test` green; the sample-report DB test passes on the phase-0 snapshot |

A change that moves a number is committed with the eval run that measured it.

---

## 8. Performance and scaling considerations

- **Trigram `<%` over 438k rows is the cost** (2.4 s/row). Options, in order:
  (a) pre-filter by full-text first and run `word_similarity` only on that
  candidate set plus the top trigram hits from a `LIMIT`ed index scan with
  `pg_trgm.word_similarity_threshold` tuned (measure 0.3 vs 0.45);
  (b) `SET LOCAL pg_trgm.word_similarity_threshold` per query so the GIN index
  prunes more; (c) cap `searchText` length (long identifying names dominate
  trigram time). Measure each with `npm run perf -- --rows 3000` before and
  after; keep what helps.
- **Full-text** 1.15 s/row is high for a GIN tsvector: check the plan for the
  OR'ed `to_tsquery`; the "selecting terms" query may be forcing a sequential
  scan when every term is common. `EXPLAIN (ANALYZE, BUFFERS)` on three typical
  queries goes into the report.
- **Vector** 0.49 s/row with HNSW `ef_search` default; keep. The exact scan the
  hashing provider forces (~1.7 s) disappears with e5.

> **Implementation note (2026-10-21, phase 4).** `EXPLAIN (ANALYZE, BUFFERS)`
> on `mxik_scratch` (same data and indexes as `mxik` minus HNSW) contradicts
> the full-text premise above: the three full-text queries take 1.4, 11.0 and
> 1.4 ms (bitmap index scan on `mxik_code_search_vector_idx`, 189–1,285 heap
> rows; the 10,000-doc "selecting terms" cutoff of 2026-10-16 already fixed
> it). Trigram is the whole lexical cost: "truba vodogazoprovodnaya" 655 ms
> cold / 661 ms warm, because the GIN bitmap admits 9,836 rows that each
> need a heap recheck in a table whose rows are ~3.9 KB wide (inline
> embeddings), 43k buffers; "kraska vodoemulsionnaya belaya" 81 ms (456
> rows), "gipsokarton knauf" 30 ms (256 rows). Raising
> `pg_trgm.word_similarity_threshold` for the same query: 0.7 → 326 ms
> (5,168 rows), 0.75 → 81 ms (619), 0.8 → 60 ms (365), with the *same* top
> 50 (all score ≥ 0.8). Option (b) is therefore implemented as an exact
> cascade rather than a tuned threshold: a strict pass (default 0.75), and
> the default-threshold query only when the strict pass does not fill the
> limit, which by construction returns the identical list (proved by a DB
> test on three queries and by identical eval outcomes). Options (a) and
> (c) were not needed for the measured queries; a narrow side table for
> `searchText` (to make each recheck cheap) is the next lever if the
> fallback path dominates on real catalogues.
- **Concurrency** 8 is per process; Postgres `max_connections` and the pool size
  in `store.ts` bound it. Do not raise concurrency before the per-row cost drops.
- **60,000-row catalogue**: run `npm run perf -- --rows 60000` once after the
  lexical work; the audit must complete, resume after a kill, and the report
  must open. Record it.
- **Memory**: `ts_stat` term counts (~5 s, once per process) and the dictionary
  are loaded per process; fine for one app container.

---

## 9. Implementation phases and dependencies

Work happens on a branch cut from `claude/matching-quality-661c2d`. Each phase
ends with a commit, a green `typecheck && lint && test`, and an eval run whose
label names the phase.

**Phase 0: data layer (owner's machine, outside the implementation session).**
`npm run classifier:update` (downloads the current export, new snapshot, diff),
fetch e5 weights, `npm run embed:catalog`, confirm `embedding_state` and
`/api/health`. Dependency for every "vectors on" number. The implementation
session must **not** run this against the shared DB; it may run everything
"vectors off" and in degraded mode in the meantime, and must label its runs so.

**Phase 1: measurement.** Add `eval/real-construction.csv`; add
`classifierSnapshotId` to eval runs and `pipelineMeta`; add the top-5-miss token
diagnostic to `eval/run.ts`; run the baseline on the current data and commit it.
No engine change. Depends on nothing.

> **Implementation note (2026-10-21).** Done in `3472a2b`/`6257198`. Runs 16
> and 17 (shared `mxik` DB, read only) reproduce §7.2 exactly. The miss
> diagnostic on run 17: of 64 real top-5 misses, 45 share no word or stem
> with the correct code (vocabulary: "арматура" vs "прокат арматурный",
> "уголок" vs "угловые профили", "минвата"), 9 share only an inflected
> stem (armatura~armaturali, kirpich~kirpichi, fiting~fitingi). Eval runs
> now also record the database name, because from phase 2.3 on every run
> is made on **`mxik_scratch`**, a copy of `mxik` in the same container
> (schema + data streamed with `pg_dump | psql`, all indexes except the two
> HNSW ones, which the hashing provider never uses: it forces an exact
> scan). The migration of §3.1 can only be applied there, so the whole
> before/after series moves there; a reproduction run on the copy confirms
> it gives the same numbers as `mxik`.

**Phase 2: retrieval.** 3.4 relevance guard; 3.3 synonym table; 3.1 weighted
search vector (migration + loader + store + evidence); 3.5 unit-aware rules.
Each as its own commit with its eval. Depends on phase 1 for the sets.
The migration is additive and must be safe to apply to a live DB (`CREATE INDEX
CONCURRENTLY` is not available inside a Prisma migration transaction; build the
column in the migration and the index in `load:db` or a follow-up migration
marked as such, and document it).

**Phase 3: ranking and calibration.** 3.2 position-level fusion; 5.5 non-semantic
vector weighting; 3.6 weight re-fit with `docs/scoring.md` updated; §6 re-audit
diff on demo and real catalogues; §12 dictionary rekey script. Depends on phase 2.

**Phase 4: performance.** §8 lexical and full-text work with `EXPLAIN` evidence;
60,000-row perf run. Depends on phase 2 (query shape changes first).

**Phase 5: reranker measurement (needs `ANTHROPIC_API_KEY`).** Eval with the
reranker on all sets, cost per row, gate tuning, cache key check. Depends on
phases 0 and 3. If no key is available, the phase ends with the exact command
and the expected cost estimate from `rerank-usage.ts`.

> **Implementation note (2026-10-21, phase 5).** No key (`ANTHROPIC_API_KEY`
> is empty in `.env`), so nothing was sent. The eval's dry run now renders
> the real prompt of every row the gate passes and prints an estimate
> through `rerank-usage.ts` (run 33): 384 of 473 rows pass the default gate
> (0.95 / 0.10), 48 calls of 8, ~1.43 M input and ~0.12 M output tokens
> (assumptions printed with it: ~3 characters per input token, 300 output
> tokens per row, no extended thinking). Claude Opus 5.5 ($4 / $20 per M):
> **~$8.02 for the eval, ~$16.96 per 1,000 catalogue rows**; Sonnet 5.5
> ~$8.48, Haiku 5.5 ~$0.42 per 1,000 rows at the table's prices. The cache
> check found the snapshot covered only through code sets; the fingerprint
> now covers names and paths (`4fbc0ed`). The exact command, after phase 0:
>
> ```
> ANTHROPIC_API_KEY=… npm run eval -- --label "plan phase 5: reranker on, e5 vectors, snapshot <date>"
> ```
>
> then tune with `RERANK_GATE_CONFIDENCE` / `RERANK_GATE_MARGIN` (same
> command, one run per setting) until high-band coverage rises with
> high-band precision still 100%.

**Phase 6: report.** Full diff review, before/after tables for every set and
config, open items, the final commit hash. Nothing is pushed or merged.

---

## 10. Files and modules expected to change

| Area | Files |
|---|---|
| Normalisation | `src/core/normalize/synonyms.ts` (new), `abbreviations.ts`, `noise.ts` (× and * sizes), `index.ts` (`lexicalText`, `embeddingText`), tests |
| Retrieval | `src/core/match/store.ts` (weighted full-text, trigram threshold, EXPLAIN-driven changes), `query.ts`, `relevance.ts`, `evidence.ts` (`matchedHierarchyWords`, `synonymApplied`) |
| Ranking | `src/core/match/fusion.ts` (position fusion), `score.ts` + `docs/scoring.md`, `rules.ts` (unit adjustments), `pipeline.ts` (wiring, `notes`, degraded reasons), `types.ts` (`Signals.positionRrf`) |
| Data | `prisma/schema.prisma` + additive migration (`searchVectorWeighted`), `scripts/lib/load-classifier.ts` (weighted vector, quality checks), `scripts/embed-catalog.ts` (shared `embeddingText`), `scripts/update-classifier.ts` (snapshot id in logs) |
| Audit | `src/lib/audit-runner.ts` (`pipelineMeta.classifierSnapshotId`), `src/core/audit/checks.ts` only if evidence fields change |
| Health | `src/app/api/health/route.ts` (classifier age) |
| Eval | `eval/run.ts`, `eval/metrics.ts`, `eval/cases.ts`, `eval/real-construction.csv` (new), `eval/real-metal.csv`, `scripts/eval-feedback.ts` (new), `docs/eval-results.json`, `docs/perf-results.json` |
| Docs | `docs/SESSION_STATE.md` (matching engine + eval sections), `docs/scoring.md`, this plan (updated where reality differed) |

Not expected to change: UI components, API routes other than health, Prisma
models other than `MxikCode`, the audit job lifecycle, bulk actions, i18n beyond
new evidence labels.

---

## 11. Testing and regression-prevention strategy

- Every pure module keeps a sibling `*.test.ts` (node:test, as the repo does).
  New: `synonyms.test.ts`, `fusion.test.ts` position cases, `relevance.test.ts`
  expanded-token cases, `score.test.ts` re-fit values, `load-classifier` quality
  checks with a fixture NDJSON of ~20 codes.
- DB-backed tests follow the existing pattern (skip with a reason when Postgres
  is unreachable); the weighted vector gets one store test against the local DB.
- `npm run eval` is the regression gate for accuracy: a phase commit includes
  its run, and the report compares against §7.2. A drop on golden or synthetic
  beyond the tolerance blocks the commit.
- `npm run perf -- --rows 3000` before and after phase 4; the 60k run once.
- The two real files are re-audited through the app at the end (upload, map,
  audit, report) and the finding-type counts are compared with today's
  (423 rows: 0 findings; 168 rows: 168 MISSING, all low band).
- No test is weakened to pass. The DB-version `sample-report.test.ts` failure is
  resolved by phase 0 data or by making the test state its expected snapshot
  and skip with a reason, never by deleting the assertion.

  > **Implementation note (2026-10-21).** Done the second way, for the one
  > failing subtest only: "every code in the explorable catalogue exists"
  > reads the snapshot the sample states it was generated from
  > (`classifier.snapshot` = 15.10.2026, 442,719 codes) and skips, saying
  > so, when the local `catalog_snapshot` is older; on that snapshot or a
  > newer one the unchanged assertion runs. The other DB subtest still runs
  > and passes on the August copy.

---

## 12. Risks, limitations, rollback, unresolved questions

**Risks**
- *Data drift repeats.* If phase 0 is done by hand again without a recorded
  procedure, the next machine will disagree with the docs again. Mitigation:
  phase 0 is a script invocation plus two recorded ids.
- *Normalisation change breaks stored keys* (P13). `FirmMapping.nameKey`,
  `CatalogItem.normalizedName`, `groupKey` were computed with the old fold.
  Mitigation: a one-off `scripts/rekey-normalized.ts` that recomputes them
  (idempotent, logs counts, dry-run flag), run after deploy; `literalKeys` on the
  branch already keeps exact lookups working for classifier keys.
- *Weighted vector migration on a live DB.* Column add is cheap; GIN build on
  438k rows takes minutes and locks writes in a transaction. Mitigation: build
  in `load:db` outside the migration, document the window.
- *Synonym table over-reach.* A synonym applied without context can pull every
  "арматура" row to rebar, including pipe fittings. Mitigation: context gates,
  tests per entry, and the eval sets must include counter-examples.
- *Calibration drift.* Re-fitting weights to 400 rows risks overfitting the
  metal set. Mitigation: hold out 20% of each real set when fitting; report
  both.
- *Reranker cost.* Unknown until phase 5; the gate exists to cap it.

**Limitations**
- Real data is still two product families (metal, construction). Food, pharma,
  services and retail remain covered only by 12 hand-written rows.
- "Correct code" is not normative; labels use position prefixes where several
  codes are defensible, which makes top-1 easier than a strict label would.
- The reranker ceiling means retrieval-only results stay below bulk-accept by
  design; this plan does not change that.

**Rollback**
- Every phase is a separate commit on the branch; reverting a phase is a
  `git revert` of its commits. The weighted vector column is additive and unused
  until `store.ts` reads it; reverting the store change disables it without a
  migration. The synonym and abbreviation tables are data: an entry is removed
  by deleting a row. `EMBEDDING_PROVIDER=hashing npm run embed:catalog -- --restart`
  returns vectors to the stand-in in ~24 min (documented).

**Unresolved questions (for the owner)**
1. Can phase 0 run on this machine now (2.7 h CPU, ~100 MB download), and may
   the `tmp/found-catalogs` test org and catalogues be re-audited afterwards?
2. Is an `ANTHROPIC_API_KEY` available for phase 5, and what per-row cost is
   acceptable?
3. Should `real-construction.csv` be labelled by the owner (domain knowledge of
   how sellers write names) or by the implementer from the official names?
4. Is 8-digit position the agreed unit of "correct" for eval labels where the
   classifier has many identifying codes, or must base codes be preferred?

---

## Handoff for the implementation session

- Repository: `C:\Users\User\Desktop\pets\mxik-audit`. Work in a new worktree cut
  from `claude/matching-quality-661c2d` (the branch with the first fixes), never
  in the main checkout, which another session is editing.
- Read this file, then `docs/PRODUCTION_PLAN.md`, `docs/scoring.md`,
  `docs/SESSION_STATE.md` §"Matching Engine" and §"Evaluation", and the branch's
  last commit message (`git show --stat 6b02185`).
- Shared local DB on port 54329: read and eval only. No migrations applied to it
  by the session; write migrations as files, test them on a scratch database
  (`createdb`-style via `docker exec`), and say so in the report.
- Dev server on port 3000 belongs to the owner; use another port if one is
  needed.
- Do not run `npm run inspect:xlsx` (overwrites a tracked doc). Do not push, do
  not merge, do not touch `main`.
- Validation: `npm run typecheck && npm run lint && npm test`, `npm run eval`,
  `npm run perf -- --rows 3000`.
- Before removing any worktree, remove its `node_modules` junction first
  (shared `node_modules`).
