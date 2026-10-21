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
| 60,000-row run recorded | | running at ~2.4 rows/s (§6) | pending |

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

**60,000 rows.** Started on `mxik_scratch` at 2026-10-21 ~17:20 local with the committed code
(`npm run perf -- --rows 60000`). When this report was first committed it read
"audited 180 / 60,000  2.3 rows/s  ETA 26337s": about 2.4 rows/s, so ~7 hours end to end, almost all of it the
hashing provider's exact vector scan. The script appends to
`docs/perf-results.json` only when it finishes; the outcome is recorded in a
follow-up commit, or, if the run cannot finish, how far it got and why.

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

1. **Phase 0** is the blocker for every §7.3 target: with e5 vectors the vector
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

## 9. Final state

Branch `claude/matching-engine-06cd30`, 19 commits on top of `e5b0f3c`
before this report; the report is the next commit (`git log --oneline
e5b0f3c..HEAD`). Working tree clean apart from what the running 60,000-row
perf run will write to `docs/perf-results.json`. Not pushed, not merged.
`mxik_scratch` is left in the container (dropped with `docker exec
mxik-audit-db dropdb -U mxik mxik_scratch`), `mxik_loadtest` was dropped. The
worktree's `node_modules` is a junction to the main checkout's: remove the
junction before `git worktree remove`, or the shared `node_modules` is wiped.
