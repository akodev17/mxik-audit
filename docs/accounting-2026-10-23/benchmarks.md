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
