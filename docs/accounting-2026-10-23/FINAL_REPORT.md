# Accounting automation programme, 23 Oct 2026: final implementation report

Coordinator: one Fable session. Implementation: five Claude Opus sessions on their own branches
(plan and contracts in `docs/TASNIVO_AI_PLAN_2026-10-23.md`; external research in
`integration-research.md`; per-workstream notes `agent<N>-result.md`, handoffs `handoff-agent<N>.md`,
bug list `bugs.md`, benchmarks `benchmarks.md`, rollback guide `migrations.md`, QA checklist
`qa-checklist.md`). The owner stopped the programme at round 2 ("stop everything and merge into main if
everything works"); this report states what landed, what was verified, and what did not.

## 1. What landed on `main`

Merged through `integration/tasnivo-2026-10` (base = the QA-passed bug-fix branch of the morning +
the shared contract base commit), in the order 1 → 4 → 2 → 3 → 5A → round-2 tips → 5B:

| Workstream | Branch | What |
|---|---|---|
| 1 1C integration core | `feat/onec-integration-core` | Shared contract (`packages/contracts/src/accounting.ts`), `ImportBatch` / `ImportRecord` / `Counterparty` / `OneCExport` / `OneCConnection`; `prepareExport` / `buildExport` / `transferExport`; formats `bank_exchange_1_02` (1CClientBankExchange, windows-1251, parser round trip), `nomenclature_xlsx`, `receipt_xlsx`, `counterparties_xlsx`; OData connector (fake-server tested); counterparty matcher and 1C «Контрагенты» import; module `onec` (12 endpoints), pages `/onec`, `/onec/[batchId]`, `/onec/settings`, shared review grid; seed and benchmark scripts |
| 2 Bank statements | `feat/bank-statement-automation` | Layout registry with three generic layouts + remembered manual mapping per org (`bank_format`), normalisation (dates, exact decimals, ИНН/ПИНФЛ, accounts, МФО), noise-row dropping, balances, issues, deterministic operation rules (`bank_rule`, built-ins), duplicates (file and row), AI suggestion path (off without a key), reconciliation report + CSV; module `bank` (16 endpoints); pages `/bank`, `/bank/[id]`, `/bank/[id]/reconcile` |
| 3 Didox invoices | `feat/didox-invoice-automation` | Tolerant Didox document parser (both JSON shapes, BigInt money), zip-of-zips / JSON / ЭСФ-XLSX upload, API client with both known auth models and a fake Didox server, connection + sync, line folding and product matching, review, dry-run report; module `didox` (16 endpoints); pages `/didox`, `/didox/[batchId]`, `/didox/settings` |
| 4 MXIK intelligence and products | `feat/mxik-product-intelligence` | `Product` / `ProductAlias` / `PackagingCode` / `MxikCodeState`; `matchProducts` (deterministic stages then trigram, 100 % precision on the 1 000-row benchmark), `classifyProducts` (validity, activity, restriction, suspicion, suggestion via the audit cascade, packaging and unit checks), `upsertProducts` (never blanks a field; confirmed mappings into `FirmMapping`), `getProducts`; Tasnif runtime client with cache and kill switch; `classifier:update` stores activity for retired codes; module `products` (12 endpoints); `/products`, `/products/import`, "Add to product catalogue" on a finished audit |
| 5A Platform audit | `fix/platform-quality` | Bug list Q1–Q20 with probes, re-verification of the three known bugs (all fixed), Phase C checklist, e2e spec for the new sections |
| 5B Platform fixes | `fix/platform-quality-fixes` | Q1 (S1: shared embedder in the API + cap on checks in flight), Q2 (sid rotation after the e-mail code, QA FAIL-1), Q3 (no sign-up oracle, FAIL-2), Q4, Q5 (TRUST_PROXY), Q6 (atomic check allowance), Q9, Q11 (rollback guide, FAIL-3), Q12 part, Q13 (FAIL-4), Q14, Q16, Q17, Q18. Not done: Q7 (legal placeholders: owner text), Q8, Q10, Q15, Q19 (deferred by the list) |

## 2. Checks on the integrated branch

Run on the integrated branch after all round-2 tips and the platform fixes were merged. The first
run stopped at the owner's usage limit with one Didox API test and the web build open; both were
closed in the resumed run (23 Oct, evening) before the merge into `main`:

| Check | Result |
|---|---|
| `npm run typecheck` | green after two fixes (Didox test fakes for the extended Classification; a misplaced deps argument) |
| `npm run lint` | green except the known `no-non-null-assertion` warning in `scripts/lib/xlsx.ts`, after three fixes (cell-text helper in two Didox tests, an unnecessary cast in products/catalog.ts) |
| `npm test` (full, 2 000 tests) | 1 998 pass, 2 skipped, 0 fail. The first run had 3 failures: the rollback guide lacked the five workstream migrations, Didox counts lacked a field, and the Didox export answered 201 to its POST download (now `@HttpCode(200)`, as the bank export) |
| `npm run build:api`, `npm run build:worker` | green |
| `npm run build` (web), `API_INTERNAL_URL=http://localhost:4027` | green; the rewrite destination is in `routes-manifest.json`. The first attempt failed because `next.config.ts` imported a TypeScript module (Q18's api-rewrite); the helper is now inlined in the config |
| `prisma migrate deploy` on the dev DB | all 53 migrations applied; not run on an empty DB |
| `npm run test:e2e` on the production build (`next start` :3027, API :4027, Edge) | 66/66 pass in 12 files (5 min 13 s), including the new `accounting-platform` spec |
| Agent 5 Phase C regression | not run |

## 3. Verified end to end vs implemented only

| Flow | Verified | Not verified |
|---|---|---|
| Bank statement → review → approve → `kl_to_1c.txt` | Yes, on the integrated code, from three synthetic fixtures through the bank module's own endpoints into Agent 1's builder (balances reconcile, 1 000-line benchmark 0.4 s) | No real bank file (none exists in the repo); the Uzbek 1C edition's МФО key is unknown (both variants shipped); no file has been loaded into a real 1C |
| Didox invoice → review → `receipt_xlsx` + `nomenclature_xlsx` | Parser, upload, sync against a fake Didox, matching and review verified by tests and in the browser; the builders verified by Agent 1's golden files | The end-to-end run on the integrated code stopped at review: the synthetic fixtures' MXIK codes are not in the local classifier, so every line was (correctly) `unresolved` and nothing was exported. Only `GET /v1/measures/all` was called on the real Didox; no credentials exist |
| Product catalogue import → classify → `nomenclature_xlsx` | Import, classification and review verified in the browser and by 50 tests; eval numbers unchanged | Same as above for the export step on the integrated run; the 1C «Номенклатура» preset is unverified (no real export) |
| MXIK audit (existing) | Unchanged; tests green; its 1C CSV/XLSX now built by the shared module | — |
| Authentication, trial quota, tenant isolation, CSRF | Re-verified by Agent 5 with probes over every session endpoint on the base; Q1–Q6 fixed with tests | Live SMTP, Google and Telegram still need the owner's credentials |

## 4. Performance (measured, development PC, shared Postgres under load)

| Workload | Result |
|---|---|
| Bank: 1 000 lines parse → normalise → match → validate → write | 389 ms median; 10 000 lines 2.5–4.6 s |
| 1C: prepare + build of a 1 000-record bank batch | 1.6 s (idempotent repeat 0.2 s) |
| Didox: 100-line invoice / 1 000 lines in 10 invoices | 53 ms / 543 ms (matcher stubbed at measurement time) |
| Products: `matchProducts` 1 000 lines / `classifyProducts` 1 000 rows (no reranker key) | 3.3–4.1 s / 142.7 s (143 ms per row, lexical + vector stages dominate) |

The one-minute target holds for bank statements and invoices; MXIK classification of 1 000 new
products takes about 2.5 minutes without the reranker and is the known cost centre.

## 5. Blocked on the owner

1. Real bank statements (one per pilot bank) and one bank-statement file exported from a client's 1C.
2. Didox partner/test access or a real zip export (request text in `agent3-result.md`).
3. A «1С:Бухгалтерия для Узбекистана 3.0» test base to load the three file kinds once; an
   OData-published base for the direct route.
4. A real 1C «Номенклатура» export; a known-deactivated MXIK code.
5. Credentials: `SMTP_URL`/`MAIL_FROM`, `GOOGLE_CLIENT_ID/SECRET`, `TELEGRAM_BOT_TOKEN/USERNAME`;
   optional `ANTHROPIC_API_KEY` for the AI paths. Legal text for `/maxfiylik` and `/oferta` (Q7).

## 6. Left open

- Agent 5 Phase C (the full regression checklist on the integrated branch) did not run; the
  coordinator ran the check set in §2 instead.
- Round-2 items committed as work in progress at the stop (Agents 2, 3, 4): taken as they were and
  validated by the check set, not by their authors.
- Bugs deferred by the list: Q7, Q8, Q10, Q15, Q19. Handoff requests not yet applied are listed in
  each `handoff-agent<N>.md`.
