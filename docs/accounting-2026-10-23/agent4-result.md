# Agent 4 result: MXIK intelligence and product catalogue (2026-10-23)

Branch `feat/mxik-product-intelligence` (worktree `mxik-product-intelligence-1843a6`), cut from the base
commit `36ef476`. Not pushed; `main` and `integration/tasnivo-2026-10` untouched.

## Commits

| Commit | What |
|---|---|
| `7f034ee` | Prisma `Product`, `ProductAlias`, `PackagingCode`, `MxikCodeState` (Agent 4 section; migration `20261104000100_products_packaging`); ports 4024/3024 |
| `cda1a05` | `matchProducts`, `classifyProducts`, `upsertProducts`; Tasnif runtime client; lazy packaging/activity cache; tests (fake Tasnif, 50-product org) |
| `0be5a2f` | `classifier:update` asks Tasnif about retired codes (isActive/status → `mxik_code_state`); `tasnif-catalog.md` with today's probes |
| `3d7e86b` | test fixture fix |
| `fee4c21` | Products API (12 endpoints, module `products`), import pipeline, from-audit, 1C hand-over; migration `20261104000200_product_alternatives` |
| `fc93237` | import tests |
| `00f72f0` | web: `/products`, drawer, `/products/import` wizard, "Add to product catalogue" on `/catalogs/[id]`; screenshots |
| `4c6d605` | catalogue operation tests, handoff proposals, benchmark script |
| (last) | this note, `benchmarks.md` "Products", lint fixes, activity-log group for `product.*` actions |

## What was built, and how it was verified

| Deliverable | State | Evidence |
|---|---|---|
| Tasnif access documented with live evidence | **verified live** (5 endpoints + Excel range, 2026-10-23) | `tasnif-catalog.md` §1; recorded answers in `packages/domain/src/products/fixtures/` |
| Runtime client: timeout, retry, rate limit, cache, `TASNIF_LIVE=false` | implemented, unit-tested, **ran live** (300-code survey; drawer packaging) | `tasnif-client.test.ts` (14 tests, fake fetch: retries, timeout, not-found, concurrency ≤ limit, kill switch) |
| `classifier:update` stores activity of retired codes | implemented; **ran live** with `--activity-only 4 --activity-sample 300`: 300/300 `isActive:"1"`, `status:0`; snapshot #4 retired 0 codes, so the retired-code path has not met a real retired code | `scripts/update-classifier.ts`, `classifier-activity.ts` |
| Packaging lazily (table + fetchedAt, batched, rate-limited) | implemented, tested with the fake; **ran live** in the drawer and the import (Coca-Cola code: 4 packages; Эторелекс: 3) | `packaging.ts`, `products.test.ts` "packaging cache" |
| `matchProducts` | implemented, 11 tests on a seeded 50-product org (each basis, size guard, client scope, 1 000 lines in order) | `products.test.ts` |
| `classifyProducts` | implemented on the audit cascade (`checkItem`), 3 tests + import flow + browser run | `products.test.ts`, `import.test.ts`, screenshot 03 |
| `upsertProducts` (never blanks; aliases; confirmed → FirmMapping) | implemented, 5 tests | `products.test.ts` "upsertProducts" |
| Product table + `/products` (search, status chips, client filter, drawer, Confirm MXIK) | implemented; browser-verified on :3024 | screenshots 05–07; `catalog.test.ts` |
| Bulk import wizard (file → columns → chunked check → review → save → 1C) | implemented; browser-verified with a 20-row 1C-style file | screenshots 02–04; `import.test.ts` |
| "Add to product catalogue" from an audit | implemented; browser-verified (demo catalogue: 119 settled rows → 118 products) | screenshot 08; `import.test.ts` |
| Export to 1C via Agent 1's `nomenclature_xlsx` | calls `prepareExport`/`buildExport`; against the base-commit stub it answers "available after integration" (verified in browser and test) — **not verified against Agent 1's real builder** | screenshot 04 |
| 1C «Номенклатура» preset | **unverified** (`verified: false`): no real export available; the wizard warns | `import-map.ts` |

Screenshots: `docs/accounting-2026-10-23/agent4/` (02 columns with the 1C preset, 03 review grid after
the check, 04 saved + 1C unavailable, 05 product list, 06 drawer, 07 after "Confirm MXIK", 08 "Add to
product catalogue" on an audit). The test data created in the demo org for the screenshots (138
products, 3 firm-dictionary entries, 2 batches) was deleted afterwards.

## The interface (§4.4), as implemented

`packages/domain/src/products/index.ts` keeps the three signatures; additions are optional:

- `matchProducts(orgId, clientId, lines, { locale? })`, stages in order, each one bulk query for all
  lines: `onec_ref` → `barcode` (GTIN with a valid check digit; in-store numbers ignored) → `mxik`
  (same code and unit **and** trigram similarity ≥ 0.35 between the names — a shared code alone never
  decides) → `name_exact` / `name_normalized` (folded name with sizes kept) → `alias` →
  `confirmed_mapping` (FirmMapping code held by exactly one product) → pg_trgm similarity (one LATERAL
  query, ≤ 5 neighbours ≥ 0.45 per line). `matched` only on one certain candidate: a single
  deterministic hit, or similarity ≥ **0.80** with a margin ≥ **0.10** over the runner-up, the same unit
  and the same numbers in the name (so "1,5 л" never becomes "0,5 л"); several plausible = `ambiguous`
  (≤ 5, each with a reason); nothing = `new`. Scope: the client's own products and the org's own.
  Thresholds: set on the 50-product fixture (`products.test.ts`: 0.80 matches a spelling variant,
  "Logitech M185" / "M-185", and leaves size variants ambiguous) and checked on the 1 000-row
  benchmark against the known answers: 841 matched, **0 wrong**, 93 ambiguous (all with the right
  product among the candidates), 7 left `new` although the product existed.
- `classifyProducts(orgId, lines, { locale?, packaging?, liveActivity?, client?, ctx? })` returns the
  §4.4 Pick plus `issues`. Statuses: `ok`, `missing`, `invalid` (not 17 digits, or not in the
  classifier), `inactive` (retired by absence from the export, or `isActive:"0"` cached from the API),
  `restricted` (`restricted_code` with its effective date; error once in force, warning before),
  `suspicious` (the audit's MISMATCH, or a self-score < 0.6 with no word shared with the code's names,
  `relevance.ts`). Suggestion: the audit cascade's best candidate (firm dictionary first; for a
  restricted code, the detailed code of its position), with `reason` and `basis`; the reranker runs
  only for rows its gate calls uncertain, as in the audit. Packaging: the line's package code must be
  in the code's `packages[]`, and its unit must match the line's unit.
- `upsertProducts(orgId, clientId, records, actorId, { source?, confirmed? })`: identity = (org, client,
  normalised name, unit); never overwrites a non-empty field with an empty one; other names become
  aliases; records in `confirmed` are learned into **FirmMapping** (one confirmation each) — no second
  mapping table.

Issue codes emitted (labels uz/ru in `ta.productsX.issues`): `mxik_missing`, `mxik_malformed`,
`mxik_not_found`, `mxik_inactive`, `mxik_inactive_api`, `mxik_restricted`, `mxik_suspicious`,
`unit_conflict`, `package_not_of_code`, `package_unit_conflict`, `package_unchecked`, `package_missing`,
`barcode_invalid`, `marking_required`.

## Quality

**Eval** (`npm run eval -- --no-ablate`, snapshot #4, e5 natural-v2, no reranker key), before = the
last recorded run on `main` (bdc8b18, 2026-10-21), after = this branch. No matcher file was changed
(`packages/core/src/match/**` untouched; `checkItem` only returns two more fields):

| Set | n | top-1 before | top-1 after | top-5 before | top-5 after |
|---|---|---|---|---|---|
| golden | 12 | 8 (66.7%) | 8 (66.7%) | 8 | 8 |
| real-construction | 102 | 84 (82.4%) | 84 (82.4%) | 93 | 93 |
| real-metal | 168 | 78 (46.4%) | 78 (46.4%) | 165 | 165 |
| synthetic | 191 | 177 (92.7%) | 177 (92.7%) | 187 | 187 |

The run was appended locally as run 49 and not committed (the shared `docs/eval-results.json` would
conflict with the other branches' appends; the coordinator re-runs on the integration branch).

**Tests** (all new, against the dev DB with a fake Tasnif client except the pure ones; nothing touches
the network): `tasnif-client.test.ts` 14, `products.test.ts` 22, `import.test.ts` 9, `catalog.test.ts` 5 — 50/50 pass.

**Checks**: `npm run typecheck` green; `npm run lint` green (one pre-existing warning in `scripts/lib/xlsx.ts`);
`npm test`: 1 779 tests, 1 774 pass, 2 skipped, 3 failed before the last fixes: `activity-actions.test.ts`
(my new `product.*` audit actions needed a log group and labels — fixed: dictionary group, uz/ru labels),
`demo.test.ts` "purges expired demo copies" (passes alone; fails only when the whole suite shares the dev
DB with other sessions' processes), and `robots.test.ts` on `/bank` — **red on the base commit `36ef476`**
(the new `(app)` sections are missing from `PRIVATE_PATHS`; Agent 5 fixes it on its branch). After the
fixes the three files were re-run: activity and demo pass, robots fails as on the base commit.

**Benchmark** (`docs/accounting-2026-10-23/benchmarks.md` "Products", 1 000 rows, no reranker key):
classifyProducts 142.7 s (142.7 ms/row, 7 rows/s; lexical 42%, vector 22%, full-text 13% of stage time),
matchProducts 3.3–4.1 s for 1 000 lines in one call (60–220 ms per 100), match precision 100% on the
known answers; packaging 6.1 s for 50 codes cold, 0.45 s warm. Reranker estimate: the gate would send
78.7% of the rows, ≈ $16 per 1 000 rows on claude-opus-5-5 (RERANK_* defaults).

## Not done / limits

- Agent 1's `nomenclature_xlsx` builder is a stub on this branch: the export path is wired and answers
  "available after integration"; the file itself is untested.
- The shared review grid (`onec/review`) does not exist yet; the import has its own review table
  (accept suggestion / skip / reopen). Correcting a unit or package code in the grid is not built.
- Activity: only cached answers are used during classification; a live history call per code is
  available (`liveActivity: true`) but off by default (it would be a crawl on big catalogues).
- No reranker key here: the AI path was not exercised; its cost is estimated in the benchmark.
- `Артикул` is recognised but not stored (proposal 3 in `handoff-agent4.md`).

## What the owner must provide

1. **A real 1C «Номенклатура» export** (Excel, as their 1C saves it) to verify the preset's headers
   (`Код из классификатора`, `Код упаковки` especially) and flip `verified` to true.
2. **A code known to be deactivated** (from a tasnif.soliq.uz announcement) to see what the history
   endpoint answers (`isActive:"0"`? another `status`? "not found"?) — today 301/301 codes answered
   `isActive:"1"`, `status:0`.
3. Optional: an `ANTHROPIC_API_KEY` to measure the reranker path for real instead of estimating it.
