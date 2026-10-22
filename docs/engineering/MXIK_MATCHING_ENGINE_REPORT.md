# MXIK matching engine: implementation report

Date: 2026-10-21. Implemented by a separate Claude Opus 5.5 session, started
from the planning session, working only in the git worktree
`.claude/worktrees/matching-engine-06cd30` on branch
`claude/matching-engine-06cd30` (cut from `e5b0f3c` on top of `6b02185`). The
main checkout was never touched. Nothing was pushed, merged or deployed. No
migration and no write was made to the shared database `mxik`; every write
went to `mxik_scratch` (a copy made for this work in the same container) or to
a throwaway `mxik_loadtest` (dropped).

**Every accuracy number in this report is degraded mode**: classifier
snapshot #2 of 2026-08-20 (438,925 live codes), hashing (non-semantic) vectors,
no reranker key. They are comparable with each other and with the plan's §7.2,
not with the October e5 numbers, and not with the §7.3 targets, which the plan
defines on the phase-0 data layer.

## 1. Where the plan is and what changed in it

`docs/engineering/MXIK_MATCHING_ENGINE_PLAN.md`. The original text is kept;
every deviation is a dated "Implementation note (2026-10-21, phase …)" block at
the section it concerns: §3.1 (weighted vector opt-in, why `scriptAlternates`
was not applied, weights), §3.2 (position fusion opt-in, no base-code
injection), §3.3 (eight synonym entries, "уголки" replaced by the classifier's
wording, кирпич not added), §3.4, §3.5 (premise corrected by the data:
fittings and steel pipes are both *strict*-bound), §3.6 (fit with hold-out,
weights unchanged), §5 (stand-in exclusion fails the golden criterion), §7.1
(construction set labelling, one widened label), §8 (full-text is not the
bottleneck; exact trigram cascade), §9 phase 1 and phase 5, §11
(sample-report test).

## 2. Phases

| Phase | State | Commits |
|---|---|---|
| 0 data layer | **not run, by instruction** (owner's, shared DB) | – |
| 1 measurement | done | `3472a2b`, `6257198`, `5e3ab1f` |
| 2 retrieval | done: 3.4, 3.3, 3.1 (opt-in), 3.5, one commit and eval each | `ef6d3ec` … `3de389e` |
| 3 ranking and calibration | done: 3.2 and §5 built and measured, opt-in; 3.6 fit with hold-out, weights unchanged; §6 re-audit diff (one regression found and fixed); §12 rekey script | `e7bae86`, `a947213`, `afeefa0`, `3b02063` |
| 4 performance | EXPLAIN done, trigram cascade done, perf 3,000 before/after done, 60,000 run: see §6 | `c7568aa`, `4eddd7e` |
| 5 reranker | **no key**: command and estimate recorded; cache-key check found a gap, fixed | `4fbc0ed`, `628780e` |
| 6 report | this file | this commit |

## 3. Modules changed

| Area | Files |
|---|---|
| Normalisation | `src/core/normalize/synonyms.ts` (new) + test, `units.ts` (`quantityKind`, `kindOfUnit`) + test |
| Retrieval | `src/core/match/store.ts` (weighted column opt-in, term stats per column/weight, hierarchy words, trigram cascade, `recommendedUnits`, `lexicalStrictThresholdFromEnv`) + test, `relevance.ts` + new test, `search-document.ts` (new) + test, `query.ts` unchanged |
| Ranking | `fusion.ts` (list weights, `groupFusion`) + test, `pipeline.ts` (synonyms, hierarchy evidence, `positionFusion`, `nonSemanticVectorWeight`, injectable weights) + test, `score.ts` (`SignalWeights`, `positionRrf`), `rules.ts` (two unit rules) + test, `types.ts`, `evidence.ts` (`synonymApplied`, `matchedHierarchyWords`) + test, `rerank-cache.ts` / `rerank-batched.ts` (content fingerprint) + test |
| App | `src/lib/audit-runner.ts` (snapshot in `pipelineMeta`, env threshold), `pipeline-meta.ts` + test, `row-signals.ts` + test, `i18n-parts/matching.ts` (uz/ru lines for synonyms, hierarchy words, two unit rules) |
| Data | `prisma/schema.prisma` + migration `20261023100000_weighted_search_vector` (additive), `scripts/lib/load-classifier.ts`, `scripts/lib/weighted-search.ts`, `scripts/build-weighted-search.ts`, `scripts/rekey-normalized.ts`, `scripts/reaudit-diff.ts` |
| Eval | `eval/real-construction.csv` (102 rows), `eval/run.ts`, `eval/diagnose.ts` + test, `eval/split.ts` + test, `eval/fit-weights.ts`, `eval/memo-store.ts` |
| Docs | the plan, `docs/scoring.md`, `docs/SESSION_STATE.md`, `.env.example`, append-only `docs/eval-results.json` (runs 16–35), `docs/perf-results.json`, new append-only `docs/weight-fit-results.json` and `docs/reaudit-results.json` |
| Tests | `src/lib/sample-report.test.ts`: the full-catalogue check states its snapshot and skips on an older copy (assertion unchanged) |

## 4. Accuracy, before and after (degraded mode)

top-1 / top-5 % · hc = high-band coverage % · hp = high-band precision %.
Runs from `docs/eval-results.json`; 17 is on `mxik`, the rest on
`mxik_scratch` (run 18 reproduces 17 exactly). For reference, the plan's §7.2
"before branch" (`e39d80c`): golden 66.7/83.3, metal 33.9/48.2 (vector off
34.5/47.6).

**All stages**

| Run | Step | golden | construction | metal | synthetic |
|---|---|---|---|---|---|
| 17 | phase 1 baseline (mxik) | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 67.6 / 82.4 · hc 7.8 · hp 100.0 | 44.0 / 74.4 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |
| 18 | baseline on scratch | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 67.6 / 82.4 · hc 7.8 · hp 100.0 | 44.0 / 74.4 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |
| 19 | 2.1 relevance | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 67.6 / 82.4 · hc 7.8 · hp 100.0 | 44.0 / 74.4 · hc 0.0 · hp – | 92.1 / 96.3 · hc 31.9 · hp 100.0 |
| 22 | 2.2 synonyms | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 75.5 / 88.2 · hc 7.8 · hp 100.0 | 45.8 / 75.6 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |
| 26 | 2.3 weighted FTS on | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 75.5 / 88.2 · hc 7.8 · hp 100.0 | 45.8 / 75.6 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |
| 29 | 2.4 units / end ph. 2 | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 75.5 / 88.2 · hc 7.8 · hp 100.0 | 45.8 / 75.6 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |
| 33 | ph. 3 defaults | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 75.5 / 88.2 · hc 7.8 · hp 100.0 | 45.8 / 75.6 · hc 0.0 · hp – | 92.1 / 96.3 · hc 31.9 · hp 100.0 |
| 34 | ph. 3 position fusion on | 58.3 / 66.7 · hc 41.7 · hp 100.0 | 80.4 / 82.4 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 85.3 / 93.7 · hc 31.9 · hp 100.0 |
| 35 | end ph. 3 (final) | 75.0 / 83.3 · hc 41.7 · hp 100.0 | 75.5 / 88.2 · hc 7.8 · hp 100.0 | 45.8 / 75.6 · hc 0.0 · hp – | 92.7 / 96.3 · hc 31.9 · hp 100.0 |

**Stage 4 (vector) off**

| Run | Step | golden | construction | metal | synthetic |
|---|---|---|---|---|---|
| 17 | phase 1 baseline (mxik) | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 68.6 / 79.4 · hc 7.8 · hp 100.0 | 73.8 / 96.4 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 18 | baseline on scratch | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 68.6 / 79.4 · hc 7.8 · hp 100.0 | 73.8 / 96.4 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 19 | 2.1 relevance | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 68.6 / 79.4 · hc 7.8 · hp 100.0 | 73.8 / 96.4 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 22 | 2.2 synonyms | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 75.5 / 86.3 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 26 | 2.3 weighted FTS on | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 75.5 / 86.3 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 29 | 2.4 units / end ph. 2 | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 76.5 / 86.3 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 33 | ph. 3 defaults | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 76.5 / 86.3 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |
| 34 | ph. 3 position fusion on | 50.0 / 50.0 · hc 41.7 · hp 100.0 | 75.5 / 77.5 · hc 7.8 · hp 100.0 | 98.2 / 98.2 · hc 0.0 · hp – | 80.1 / 88.0 · hc 31.9 · hp 100.0 |
| 35 | end ph. 3 (final) | 50.0 / 58.3 · hc 41.7 · hp 100.0 | 76.5 / 86.3 · hc 7.8 · hp 100.0 | 75.6 / 98.2 · hc 0.0 · hp – | 84.8 / 91.6 · hc 31.9 · hp 100.0 |

Per step, against the previous committed run: 3.4 moved nothing; 3.3 made 12
rows better and none worse; 3.1 moved no case (opt-in); 3.5 none worse,
construction vector-off +1.0; the phase 3 defaults equal phase 2. The only
synthetic changes are the documented tie `synthetic.csv:4`.

Against the §7.3 targets (defined for the phase-0 data layer; shown here only
to say where degraded mode stands):

| Criterion | Target | Degraded mode, run 35 | |
|---|---|---|---|
| real-metal top-1 / top-5, vectors on | ≥ 80 / ≥ 95 | 45.8 / 75.6 | not met; 75.6 / 98.2 with the stand-in off, 75.6 / 98.2 with position fusion on |
| real-metal top-1 outside 072/073 | 0 | 4 (3 ribbed sheet → brass 07409, 1 wire rod → copper 07408); rebar fixed (6 at run 17) | not met |
| real-construction | ≥ 70 / ≥ 90 | 75.5 / 88.2 | top-1 met, top-5 1.8 short |
| golden | no row regresses, top-5 ≥ 83.3 | 75.0 / 83.3, no row regressed | met |
| synthetic | ≥ 90 / ≥ 95, ≤ 1 point drop | 92.7 / 96.3 | met |
| high-band precision | 100% everywhere | 100% in every run and config of the series (run 16's 87.5% was a label error, fixed) | met |
| vectors on vs off within 2 points | every set | metal −29.8 (stand-in), golden +25, synthetic +7.9 | not met; needs e5 |
| ≥ 5 rows/s, lexical ≤ 800 ms/row p50 | perf machine | 2.6 rows/s, lexical 1,513 ms/row (summed, with pool waits) | not met; hashing exact scan dominates |
| 60,000-row run recorded | | stopped at 19,556 rows for the e5 work (§6) | not met |

The weight fit (`npm run eval:fit`, 238 configurations in three fits, fit on
80% of every set, fixed 20% hold-out): baseline objective 77.17 train / 84.91
hold-out. The best configuration overall (subposition fusion, stand-in in RRF
only) reached 84.44 on training but 75.00 on the hold-out (golden 33.3, metal
100, synthetic 79.5); no feasible change beat the baseline on the hold-out. That
is why position fusion and stand-in weighting are opt-in and the weights stay.

## 5. Re-audit diff (§6) and rekey (§12)

`npm run reaudit:diff` re-audits stored catalogues in memory on the scratch copy
(`checkItem` writes nothing) and compares engine finding types row by row with
the audit stored by the app's older code (`docs/reaudit-results.json`):

| Catalogue | Stored | This branch | Change and cause |
|---|---|---|---|
| stroy-materials-423 (customer, audited this morning) | 0 findings | 0 | first re-audit found 1 new MISMATCH ("Уголок перфорированный", caused by the уголок synonym), **fixed** in `afeefa0` |
| Demo_Savdo_1C_eksport (demo template, 186, audited 2026-10-16) | MISMATCH 36 | MISMATCH 37 | the 2026-10-19 margin fix: demo-label scores equal the ones `docs/scoring.md` recorded then (34 flagged / 19 right, clean rows flagged 14/76, right suggestion 38/77) |
| demo-katalog (customer, 200, audited 2026-08-20) | MISMATCH 33 | 30 | the 2026-10-15 different-position rule |
| real-metal (168 rows, eval CSV, no stored audit) | plan §11: 168 MISSING, all low | 168 MISSING, 70 medium / 98 low | |

No new MISMATCH comes from this branch's normalisation. Privilege findings come
from a separate pass and are excluded from the comparison.

`npm run rekey:normalized -- --dry-run` on `mxik` (read only): 0 name entries in
`firm_mapping` (the 25 demo mappings of the morning belonged to a demo org the
app has since expired and purged), 215 `catalog_item."normalizedName"` values
to recompute: 200 were empty strings, 15 hold a key that today's normalisation
(including the branch's abbreviation expansion) folds differently. The real run
on `mxik_scratch` changed the same 215 rows (its dictionary line was not kept);
a second run found all 25 mapping keys and all 1,566 rows current.

## 6. Performance

**Where the time goes (`EXPLAIN (ANALYZE, BUFFERS)`, `mxik_scratch`, one query
at a time).** Full-text is not the bottleneck the plan assumed: 1.4 ms
("truba | vodogazoprovodnaya", selecting the rare term), 11.0 ms ("kraska |
vodoemulsionnaya | belaya", 1,285 heap rows), 1.4 ms ("gipsokarton | knauf");
the 2026-10-16 selecting-terms cutoff already fixed it. Trigram is the lexical
cost: 655 ms cold / 661 ms warm for "truba vodogazoprovodnaya" (the GIN bitmap
admits 9,836 rows, each rechecked in a ~3.9 KB row, 43k buffers), 81 ms for
the paint query (456 rows), 30 ms for plasterboard (256 rows). The same trigram
query at `word_similarity_threshold` 0.7 / 0.75 / 0.8: 326 / 81 / 60 ms with the
identical top 50. Hence the exact cascade (strict 0.75 pass, default query only
when it does not fill the list).

**`npm run perf -- --rows 3000`** (`docs/perf-results.json`; `mxik_scratch`,
i5-12400F, 12 threads, concurrency 8, hashing vectors with exact scan, no
reranker; same generated catalogue both times):

| | cascade off (`LEXICAL_STRICT_THRESHOLD=off`) | cascade 0.75 (default) |
|---|---|---|
| audit rows/s | 2.2 | **2.6** |
| audit time | 1,380 s | 1,140 s |
| lexical ms/row | 1,701 | 1,513 |
| full-text ms/row | 805 | 674 |
| vector ms/row | 2,062 | 1,616 |
| findings | 1,026 | 1,026 (identical) |

Stage times are summed over the 8 workers and include waiting for the shared
connection pool, which is why full-text shows ~700 ms per row while one query
takes 1–11 ms: the hashing provider's exact vector scan (≈ 1.7 s per row) holds
connections. The §7.3 throughput target (≥ 5 rows/s, lexical ≤ 800 ms/row p50)
is **not met in degraded mode**; it is defined for the phase-0 setup, where e5
uses HNSW (0.49 s/row in the October perf run) instead of the exact scan. This
machine is an i5-12400F; the October entries in `docs/perf-results.json` (and
the plan) were measured on an i5-14400F, so absolute rates do not compare
across the two; the before/after pair above ran on the same machine and data.

**60,000 rows: not completed.** Started on `mxik_scratch` at 2026-10-21 ~17:20
local with the committed code (`npm run perf -- --rows 60000`, hashing
vectors). Generating the 3.8 MB xlsx and parsing and storing all 60,000 rows
took 15.3 s; the audit then ran at 1.8–2.4 rows/s (≈ 9 h projected), almost
all of it the hashing provider's exact vector scan. It was stopped on purpose
at 20:19 local, at **19,556 of 60,000 rows audited (6,518 findings)**, because
phase 0 had landed on `mxik` and `mxik_scratch` was needed for the e5 work
(§9); a hashing-mode run on a database being re-embedded would have measured
nothing useful. Resume after a kill was therefore not exercised. With e5 and
the rebuilt HNSW index the vector query costs 13 ms instead of ~1.7 s, so the
60,000-row run should be repeated on the phase-0 setup; nothing was appended
to `docs/perf-results.json` for it.

## 7. Tests and checks actually run

Every phase ended with `npm run typecheck && npm run lint && npm test` on the
worktree (DB tests against the shared `mxik`, read only, as the suite always
does): typecheck clean; lint 0 errors and 1 warning that predates this branch
(`scripts/lib/xlsx.ts:131`); tests grew from 1079 to 1133 with 0 failures at
every gate (final gate: 1133 tests, 1130 pass, 3 skipped, 0 failed). Skips, each with its reason printed: the sample-report
full-catalogue check (local snapshot 2026-08-20 older than the sample's
2026-10-15; unchanged assertion runs on that snapshot or newer) and two
weighted-column DB tests, which skip on `mxik` (column not built there) and
pass on `mxik_scratch` (run there explicitly, 18/18 store tests). The
migration was applied with `prisma migrate deploy` to `mxik_scratch` (5.7 s)
and to an empty `mxik_loadtest` (all 41 migrations), `load:db` was run on 3,000
real records there; no Prisma command ran against `mxik`. `next build` was not
run (no UI component changed; the UI-facing changes are i18n strings and
`row-signals.ts`, covered by typecheck and tests).

## 8. Remaining blockers and risks

1. **Phase 0** (done 2026-10-22, see §9; this item kept as written on 2026-10-21) is the blocker for every §7.3 target: with e5 vectors the vector
   stage stops pulling metal rows to the wrong positions, and both opt-in
   features (position fusion, stand-in weighting) and the weights must be
   re-measured with `npm run eval` and `npm run eval:fit`.
2. **Deploying the weighted column** needs `prisma migrate deploy` then
   `npm run search:weighted` (≈ 4 min, ~2 GB of table rewrite on 438k wide
   rows; the GIN index is built concurrently, 10 s). It stays unused unless
   `fullTextColumn: 'weighted'` is set, so it can wait.
3. **Rekey** after deploy: `npm run rekey:normalized -- --dry-run`, then without.
4. **The reranker** has still never run with a key; estimate ~$17 per 1,000
   catalogue rows with Opus 5.5 at the default gate (assumptions in §9 of the
   plan).
5. **Eval data**: the construction set is implementer-written seller-style
   text, not customer data; golden is 12 rows; synthetic overestimates. The
   metal set is the only customer file.
6. **`mxik_scratch`** (about 5 GB inside the Docker volume, which lives on a C:
   drive with ~25 GB free) is left in place for the owner to re-run the series;
   `docker exec mxik-audit-db dropdb -U mxik mxik_scratch` removes it.

## 9. Addendum 2026-10-22: phase 0 and the e5 vector stage

The owner's session ran phase 0 on `mxik` (snapshot #4 of 2026-10-21, 442,964
codes, local e5 vectors). The vector stage then made the real sets worse than
no vectors at all. At the coordinating session's request this session fixed it
on the same branch; the plan's §5 note and `docs/scoring.md` ("e5 vectors
after phase 0") hold the details. Measured on `mxik_scratch`, re-cloned from the
phase-0 `mxik` (the 60,000-row hashing perf run was stopped for this, §6), and
confirmed on `mxik` by the coordinating session.

What changed, in commits `b49f409` … `3b6db1e`:

1. **Embedding text** (`src/core/embed/text.ts`): one `embeddingText()` for
   stored vectors and queries; natural text with e5's "query: " (rows) and
   "passage: " (classifier names) instead of the folded key; both vector
   columns filled and searched by the row's script; a new provider name
   (`…#natural-v2`) so folded vectors are never compared with natural queries;
   `embedding_state.columns` (additive migration `20261025100000`).
2. **HNSW recall**: the default graph (`m = 16, ef_construction = 64`) returned
   on average 47% of the exact top 50 on the metal rows; now `m = 32,
   ef_construction = 200`, `hnsw.ef_search = 1000`: 0.95, 13 ms per query
   (exact: 705 ms). New `npm run eval:recall` and `npm run vectors:reindex`
   (online, serial: a parallel build's 2 GB shared-memory segment did not fit
   in the container's `/dev/shm` and failed on `mxik` and on scratch; fixed in
   `3b71b74`, DEPLOY.md updated).
3. **Cosine band** 0.80–0.95 for semantic providers (`vectorToUnit`); two
   hold-out fits (390 configurations: band, vector weight, a per-position cap
   on the vector list, position fusion) kept it and kept the cap and position
   fusion off.
4. **`unrequestedMaterial` rule**: 40 rows better, none worse.
5. Measured and **left off**: weighted hierarchy full-text with e5 (run 46: 0
   better, 1 worse), per-position cap, position fusion (fixes 49 profile pipes,
   breaks the synthetic constraint).

**All stages**

| Run | Step | DB | golden | construction | metal | synthetic |
|---|---|---|---|---|---|---|
| 36 | phase 0 as stored: folded v1, legacy mapping | scratch | 75.0 / 83.3 | 69.6 / 88.2 | 36.9 / 86.9 | 90.6 / 96.9 |
| 37 | v1 vectors + band 0.80–0.95 | scratch | 66.7 / 83.3 | 74.5 / 87.3 | 45.8 / 96.4 | 91.1 / 96.9 |
| 38 | natural v2, HNSW m=16/64 ef 100 | mxik | 66.7 / 66.7 | 81.4 / 89.2 | 46.4 / 48.2 | 90.6 / 95.3 |
| 39 | natural v2, exact scan | scratch | 66.7 / 75.0 | 81.4 / 92.2 | 45.8 / 77.4 | 93.7 / 99.0 |
| 43 | natural v2, HNSW m=32/200 ef 1000 | mxik | 66.7 / 66.7 | 81.4 / 91.2 | 45.8 / 77.4 | 92.7 / 97.9 |
| 44 | natural v2, HNSW m=32/200 ef 1000 | scratch | 66.7 / 75.0 | 81.4 / 92.2 | 45.8 / 77.4 | 93.7 / 99.0 |
| 45 | + unrequested-material rule | scratch | 66.7 / 75.0 | 82.4 / 92.2 | 46.4 / 98.2 | 93.7 / 99.0 |

**Stage 4 (vector) off**

| Run | Step | DB | golden | construction | metal | synthetic |
|---|---|---|---|---|---|---|
| 36 | phase 0 as stored: folded v1, legacy mapping | scratch | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |
| 38 | natural v2, HNSW m=16/64 ef 100 | mxik | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |
| 39 | natural v2, exact scan | scratch | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |
| 43 | natural v2, HNSW m=32/200 ef 1000 | mxik | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |
| 44 | natural v2, HNSW m=32/200 ef 1000 | scratch | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |
| 45 | + unrequested-material rule | scratch | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |

Run 46 (weighted full-text on, otherwise as 45): golden 66.7/75.0, construction
82.4/92.2, metal 46.4/98.2, synthetic 93.2/99.0.

Against §7.3 on the phase-0 data layer: construction ≥ 70 / ≥ 90 **met**
(82.4/92.2); synthetic ≥ 90 / ≥ 95 **met** (93.7/99.0); high-band precision
100% **met**; golden no-regression **not met** (PANADOL row lost by the
natural-text vectors, which the folded ones found); metal ≥ 80 / ≥ 95 **top-5
met (98.2), top-1 not** (46.4: 49 profile pipes take the hot-rolled profile
base code, 35 hot-rolled sheets the "Лист просечно-вытяжной" base code, where
the +0.05 base-code rule outweighs unmarked identifying codes); vectors-on not
worse than off by more than 2 points: **met on construction, synthetic and
golden, not on metal top-1** (46.4 vs 75.6). The reranker is the designed
answer to the remaining metal top-1 (position-level judgement); it still has
no key.

## 10. Final state

Branch `claude/matching-engine-06cd30`: the first report was commit `5c6c4d8`
(20 commits on top of `e5b0f3c`); with the e5 work it has 27
(`git log --oneline e5b0f3c..HEAD`; this update is the last). Working tree
clean. Not pushed, not merged by this session; the coordinating session merges
into main. `mxik_scratch` (a copy of the phase-0 `mxik` with natural-v2
vectors, the m=32/200 indexes and the weighted column filled; ~6 GB) is left in
the container for re-measurement (`docker exec mxik-audit-db dropdb -U mxik
mxik_scratch` removes it); `mxik_loadtest` was dropped. On `mxik` this session
ran only read-only evals and recall probes; the re-embed, the migrations and
the index rebuild there were done by the owner's session with this branch's
code. The worktree's `node_modules` is a junction to the main checkout's:
remove the junction before `git worktree remove`, or the shared
`node_modules` is wiped.
