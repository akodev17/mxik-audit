# Accounting programme benchmarks (23 Oct 2026)

Each workstream adds its own section; the coordinator merges them.

## Didox

Agent 3, branch `feat/didox-invoice-automation`. Script: `npx tsx packages/domain/src/didox/bench.ts 5`
(median of 5 runs after one warm-up run; synthetic invoices in Didox's lower-case shape, 100 lines
each, two spellings of some product names; a throw-away org in the shared dev database, deleted
afterwards). Machine: Intel Core i5-12400F (12 threads), 64 GB, Node 20.18.2, Postgres on
localhost:54329 with `connection_limit=4`; the dev API and web servers and other sessions were
running at the same time, so absolute numbers are noisy.

| Case | parse | match (stub) | validate | write (DB) | total |
|---|---|---|---|---|---|
| 100-line invoice | 0.9 ms | 0.2 ms | 1.6 ms | 50.1 ms | 52.9 ms |
| 1 000-line batch (10 invoices × 100) | 13.8 ms | 2.3 ms | 20.5 ms | 509.1 ms | 543.1 ms |
| 1 000 lines as one zip of zips through `uploadDidoxFile` (zip-guard, unzip, duplicate queries, parse, match, validate, write) | | | | | 608.8 ms |

What each stage is:

- **parse**: `parseDidoxDocument` (key lower-casing, BigInt decimal reading, line arithmetic checks,
  canonical-JSON SHA-256 fingerprint).
- **match (stub)**: the time inside `matchProducts`. Agent 4's real matcher is not on this branch, so
  the benchmark injects an in-memory catalogue of 5 000 products with exact folded-name lookup. **The
  real matcher (lexical + vector stages, FirmMapping) will be much slower; re-measure after the merge.**
- **validate**: `checkInvoice` minus the match time (duplicate-name folding, classifier stub, MXIK /
  package / unit comparisons, statuses).
- **write**: `storeInvoice`: one transaction creating the batch and its records (`createMany`) plus
  the `didox_document` upsert. It dominates: ~0.5 ms per line on this machine.

Not measured: the Didox API (no credentials; the fake server would only measure localhost HTTP), the
1C side (Agent 1's builder is a stub here), Agent 4's classifier.
