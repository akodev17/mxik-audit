# Benchmarks of the accounting programme (2026-10-23)

Each workstream adds its own section. Machine: the development PC (Intel i5-14400F, 16 threads,
26 GB), shared dev Postgres on :54329 with several other sessions' processes running at the same
time — absolute times carry that noise.

## Products

Script: `npx tsx scripts/bench-products.ts` (full) and `-- --match-only`. 1 000 rows: the demo catalogue
(`packages/db/prisma/demo-catalog.json`, 186 rows with barcodes and codes) and the eval cases (golden,
real-construction, real-metal, synthetic: 473 rows; per row the code kept 50%, dropped 30%, replaced by
another row's code 20%), cycled with seeded name noise (`eval/noise.ts`) to 1 000. The org first gets
the first 600 rows as products (590 after identical rows fold together), so matching has a catalogue
to find. Snapshot #4 (442 964 codes), embedder `local:Xenova/multilingual-e5-small#natural-v2` (vector
stage on), **no `ANTHROPIC_API_KEY`: stage 6 off (degraded path)**.

| Step | Wall time |
|---|---|
| upsertProducts, 600 new products | 1.0 s (full run) / 5.2 s (second run, DB busier) |
| auditContext (vector readiness, dictionary, restricted list) | 46 ms |
| **classifyProducts, 1 000 rows** in 10 chunks of 100 (as the import runs) | **142.7 s = 142.7 ms/row (7.0 rows/s)**; chunk median 11.6 s, max 27.0 s |
| **matchProducts, 1 000 rows in one call** | **3.3 s** (full run) / 4.1 s (second run) |
| matchProducts, 100 rows (one large invoice) | 220 ms / 60 ms |
| packagesFor, 50 codes cold (Tasnif card + history, live) | 6.1 s (44 fetched, 2 unavailable/not found, 4 already cached) |
| packagesFor, same 50 codes warm (`packaging_code`) | 0.45 s |

For comparison, the audit itself runs 2.2–2.6 rows/s on this machine (`docs/perf-results.json`, it
also writes findings); classification is the same cascade without persistence.

classifyProducts per stage (time summed over the 8 rows in flight, so the total exceeds wall time):

| Stage | Summed ms | Share |
|---|---|---|
| lexical (pg_trgm) | 592 103 | 41.5% |
| vector (pgvector HNSW) | 307 816 | 21.6% |
| fulltext | 187 261 | 13.1% |
| existing-code (the row's own code) | 121 117 | 8.5% |
| exact (folded name) | 97 514 | 6.8% |
| restricted (replacement codes of a restricted position) | 60 318 | 4.2% |
| embed (e5 query vector) | 28 385 | 2.0% |
| self-match | 19 688 | 1.4% |
| barcode | 14 131 | 1.0% |
| rerank (dry run, no call) | 45 | 0.0% |

Outcomes on the 1 000 rows: MXIK status ok 217, missing 391, suspicious 179, restricted 181, invalid 32
(the eval sets are construction-heavy, hence the restricted share). matchProducts: matched 841
(barcode 101, name_exact 277, MXIK + unit 446, name_normalized 17), ambiguous 93, new 66.
**Against the known answer** (each row's source product is known): matched right 841, **matched wrong
0 (precision 100%)**; ambiguous with the right product among its ≤ 5 candidates 93, without it 0; new
and truly new 59; new although the product existed 7 (names the noise changed beyond 0.45 similarity).

**Reranker (stage 6), estimated** — no key on this machine, so the gate was run with a dry-run
provider (as `npm run eval` does): it would send **787 of 1 000 rows (78.7%)** in 99 calls of 8
(`RERANK_BATCH_SIZE`), ~2.85 M input + 0.24 M output tokens on `claude-opus-5-5` (default
`ANTHROPIC_MODEL`), **≈ $16 per 1 000 rows** (gate: confidence < 0.95 or margin < 0.1,
`RERANK_GATE_*`; 3 characters per input token, 300 output tokens per row). The eval's own estimate on
its 473 cases is $17.84 per 1 000 rows. Rows decided by the firm dictionary or a barcode never reach
the reranker, and verdicts are cached per org (`rerank_cache`), so a repeat catalogue costs less.
Latency with the key: not measured.

What this means for Didox (Agent 3): `matchProducts` is cheap (≈ 3–4 ms/line in bulk); `classifyProducts`
is the cost (≈ 140 ms/line degraded; with a key, ~79% of lines also go to the reranker) and should run only
for lines whose MXIK is missing or doubtful, and for each distinct normalised name once.

# Accounting programme benchmarks (23 Oct 2026)

One section per workstream; the coordinator merges them. Machine for every number below unless a
section says otherwise: Intel Core i5-12400F, Windows 10, Node 20.18.2, the shared development
PostgreSQL (Docker, port 54329) with `connection_limit=4`, other sessions using the same database
at the same time (numbers are wall-clock, not isolated).

## Bank

`npx tsx scripts/bench-bank.ts <lines> <runs>` (Agent 2, branch `feat/bank-statement-automation`).
A generated RU statement (title block with account, ИНН and opening balance; header
`Дата | № док. | Корреспондент | ИНН | Счёт | МФО | Дебет | Кредит | Назначение платежа`; amounts
as text `1 234 567,89`; a totals row and a closing balance) goes through every stage the API runs
for an upload, in a throwaway org that is deleted afterwards:

| Stage | What | 1 000 lines, median of 3 (ms) | runs | 10 000 lines (ms), 2 runs |
|---|---|---:|---|---|
| read_xlsx | `readGrid` (exceljs) + header and title location | 57 | 114 / 57 / 38 | 338 / 261 |
| parse_normalise | dates, decimals, ИНН/accounts/МФО, direction, dropped rows, balances | 15 | 22 / 15 / 10 | 122 / 111 |
| rules_load | the org's `bank_rule` rows | 2 | 2 / 2 / 2 | 2 / 2 |
| duplicates | fingerprints + one query against earlier statements of the org | 9 | 8 / 10 / 9 | 66 / 98 |
| match | `matchCounterparties` (**base-commit stub**: answers `unknown` without a query) | 0.6 | 0.7 / 0.6 / 0.5 | 6 / 6 |
| rules_validate | operation rules, issues, statuses | 3 | 7 / 3 / 3 | 32 / 27 |
| write | `createMany` in chunks of 500 + progress update per chunk | 250 | 250 / 257 / 244 | 1 919 / 1 930 |
| **end to end** | read → records written, batch in `review` | **389** | 2 468 / 389 / 335 | 4 573 / 2 468 |

- The first run of each invocation is slower (2.5 s at 1 000 lines): it includes opening the
  Prisma client's connections; the stage timings above do not separate that out. Later runs are
  the steady state.
- Writing the records dominates (≈ 65 % at 1 000 lines, ≈ 80 % at 10 000). Parsing 1 000 rows is
  ≈ 70 ms, consistent with the research note's §4 ("parsing 1000 Excel rows is negligible").
- **Not in these numbers:** real counterparty matching (Agent 1's `matchCounterparties` replaces the
  stub at integration: one query per chunk of 500 is expected, to be re-measured on the integration
  branch); AI suggestions (off in the benchmark; with `ANTHROPIC_API_KEY` at most `AI_CAP` = 200
  undecided lines go out in batches of 50, i.e. ≤ 4 calls, each typically several seconds — they
  run before each chunk is written, so a statement with many undecided lines takes that much longer);
  the 1C file build (Agent 1) and the HTTP upload itself.
- The browser flow on the RU fixture (10 lines) was read in < 1 s from "Read statement" to the
  review page (API log: `POST /api/bank/statements` 235 ms, the first poll already found it done).
