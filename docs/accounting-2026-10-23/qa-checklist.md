# Phase C regression checklist, accounting programme 23 Oct 2026 (Agent 5)

Run on `fix/platform-quality` after `git merge integration/tasnivo-2026-10` (once the coordinator says
the integration branch is ready), from the worktree root. Servers: API `tasnivo-api-4025`, web
`tasnivo-web-3025-prod` built with **`API_INTERNAL_URL=http://localhost:4025 npm run build`** (the
rewrite is baked at build time, bugs.md Q18), browsed at `http://a5q.localhost:3025`. Every item ends as
PASS / FAIL / N/A in `qa-report.md` with evidence (command output, test name, `file:line`, a probe's
output, or a screenshot under `docs/accounting-2026-10-23/agent5/`). A failure is attributed: present
on the base commit `36ef476` (see `bugs.md`, "pre-existing"), introduced by a workstream (named), or
by the merge. Fix only what blocks a check, platform areas only; everything else goes into the report.

Reference facts: trial = 14 days, clients 3 / rows 5 000 / seats 2 / API checks 500
(`packages/domain/src/billing/plans.ts:22`); `ImportBatch` is unique on `(orgId, kind, fingerprint)`
(`20261101000000_accounting_shared`, line 86) and `ImportRecord` on `(batchId, rowIndex)`; statuses from
`packages/contracts/src/accounting.ts:33-40`; probes in `docs/accounting-2026-10-23/agent5/probes/`
(copy them to `tmp/agent5/`, README there); the endpoint list is dumped with `dump.ts`.

## 0. Preparation

| # | Step | Expected |
|---|---|---|
| P1 | `git merge integration/tasnivo-2026-10`; resolve only `.claude/launch.json` (keep both) and anything platform-owned | merge commit; conflicts listed in the report |
| P2 | `npm ci`; `npx prisma generate`; `npx prisma migrate deploy` (shared DB) | exit 0; `migrate status` up to date |
| P3 | `git log --oneline 36ef476..integration/tasnivo-2026-10` and `git diff --stat 36ef476...HEAD` saved to `agent5/c-diffstat.txt` | the five workstreams and Phase B present |
| P4 | Re-dump the registry (`dump.ts`) and list the new `onec`, `bank`, `didox`, `products` endpoints with method, path, auth, role | the list drives T2, T3, I1, D1 below |

## B. Builds and static checks

| # | Check | Expected |
|---|---|---|
| B1 | `npm run typecheck` | exit 0 |
| B2 | `npm run lint` | 0 errors; warnings listed (baseline: 1, `scripts/lib/xlsx.ts:131`) |
| B3 | `npm test` without Redis, then with `REDIS_URL=redis://127.0.0.1:63799` | 0 fail; skips listed and each explained (baseline: 2 weighted-search skips); count of new tests per workstream |
| B4 | `npm run build` (web, with `API_INTERNAL_URL`) | exit 0; no new build warnings about dynamic server usage |
| B5 | `npm run build:api`, boot `dist/main.mjs` on a spare port, `GET /api/health` | 200; routes mapped = previous 170 + the new modules' count from P4 |
| B6 | `npm run build:worker` | exit 0 |
| B7 | `docker build --target api|worker|web` → `mxik-audit-*:qa-accounting` | all three build (not run); image size noted |
| B8 | `npm run test:e2e` on the production build (`E2E_BASE_URL=http://localhost:3025 E2E_CHANNEL=msedge`) | all pass; base was 60/60; the `accounting-*.e2e.ts` skeletons run (not skipped) for every module whose routes exist |

## M. Database and migrations

| # | Check | Expected |
|---|---|---|
| M1 | Every new migration folder is additive: grep each `migration.sql` for `DROP`, `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL`, `DELETE`, `TRUNCATE` | none (or justified and data-safe) |
| M2 | Names: prefixes `202611010*` (A1) … `202611050*` (A5), all sort after `20261101000000_accounting_shared`, no duplicates, `ls … \| sort -c` | PASS |
| M3 | **Empty DB:** `CREATE DATABASE mxik_qa_acc_empty`; `DATABASE_URL=…/mxik_qa_acc_empty migrate deploy` | exit 0, all migrations applied; `migrate diff --from-url … --to-schema-datamodel schema.prisma` shows only the known drift (raw-SQL indexes, `searchVector`, `catalog.clientId` trigger) |
| M4 | **Copy of a populated DB:** `mxik_qa_acc_copy` = base-commit migrations + `npm run seed` + one trial org with 2 catalogues, ledger rows, 2 clients, 1 unverified user, 1 `import_batch` of each kind written through the base's tables; record row counts; deploy the integration's migrations | exit 0; counts of `organization`, `user`, `catalog`, `client`, `usage_ledger`, `import_batch`, `import_record` unchanged |
| M5 | Shared dev DB: `migrate status`; `SELECT … FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL` | up to date; only the 3 historic resolved rows |
| M6 | `docs/accounting-2026-10-23/migrations.md` has rollback SQL for every migration since `20261027100000`, including each workstream's (Agent 5 completes the workstream sections here) | every folder listed with SQL, rows to delete, consequences |
| M7 | Each new table with tenant data has `orgId` with an FK to `organization` `ON DELETE CASCADE` (and `clientId` FK where the row belongs to a client); unique keys include `orgId` | PASS per table; list of tables |
| M8 | Drop the scratch DBs | done |

## A. Authentication and sessions (platform, after the merge)

| # | Check | Expected |
|---|---|---|
| A1 | `p1-unverified.mjs` over the merged registry | every `auth: 'session'` endpoint, including all new module ones, answers 403 `unverified` (platform-admin → 404, the 3 manual routes as before); `http-wiring.test.ts` passes and lists no new manual route |
| A2 | Browser: sign-up → `/sign-up/verify` → code from `tmp/outbox/` → `/dashboard`; `/bank`, `/didox`, `/products`, `/onec` before the code redirect to the code step | PASS, screenshots `c-a2-*.jpg` |
| A3 | `p5-fail12.mjs` | after the code: new `sid`, old cookie 401 (FAIL-1 fixed in Phase B); sign-up answers identical for new and registered addresses (FAIL-2) |
| A4 | `p11-auth-flows.mjs`, `p12-2faoff.mjs` | as in Phase A (reset, change, 2FA, recovery, end-others) |
| A5 | `p4-csrf-rate.mjs` over the merged registry | every mutating session/public route, new modules included, refuses a request without `X-Requested-With`; provider callbacks (if Didox/1C add any) have their own signature check and are the only `@SkipCsrf()` additions |
| A6 | Q5: with `TRUST_PROXY` unset, `p14-webip.mjs` and the direct variant | a spoofed `X-Real-IP` does not reset the IP bucket |
| A7 | Integration secrets (1C connection, Didox credentials) are sealed like 2FA secrets (`SESSION_SECRET`), never returned by a GET (only "set / not set"), never logged | read code + `GET /api/onec/connection` and the Didox equivalent; grep API log for the test secret |

## T. Trial enforcement and quota

| # | Check | Expected |
|---|---|---|
| T1 | `p3-quota.mjs`, `p8-parallel.mjs` | K2 still fixed: upload → delete → upload refused; parallel commits: one passes |
| T2 | Each new import entry point (bank statement upload, Didox upload or pull, product catalogue import, 1C export/transfer) on an **expired** trial org (`UPDATE organization SET "trialEndsAt" = now() - interval '1 day'`) | refused with the plan-expired message, nothing written to `import_batch` |
| T3 | Whether the new imports count against a monthly limit (rows or a new key) is what each workstream's result note says; check that the stated rule is enforced server-side, under the org lock, and that deleting a batch does not give the allowance back | as stated, no delete-restores-quota bypass |
| T4 | Client cap and seats with the new modules (`clientId` on batches): archiving or deleting a client with batches | cap unchanged as before; batches of a deleted client gone (cascade) |
| T5 | Q1/Q6 after Phase B: `p10-mem.mjs`, `p9-checkrace.mjs` (40 parallel), `p15-checkcap.mjs` | API stays up, memory bounded (record MB); total checks ≤ 500 |

## I. Tenant isolation, including the new tables

| # | Check | Expected |
|---|---|---|
| I1 | Extend `victim.mjs`: org A creates one `import_batch` of each kind (bank statement, Didox invoice, product catalogue) through the real endpoints, one export, one counterparty, one product, one saved bank format/rule, the 1C connection settings | ids written to `victim.json` |
| I2 | `p2-isolation.mjs` with the new id kinds (`batchId`, `recordId`, `exportId`, counterparty, product, format/rule ids) mapped in `P` | every read 404 or empty, every write refused, org A's snapshot (now including the batch's status and record decisions) identical before and after; `GET /api/onec/exports/{exportId}/file` of org A → 404 for B |
| I3 | Batch lists filtered by `?client=` of another org's client, and by a client of the same org the user is not assigned to (accountant role with `clientIds`) | empty / refused |
| I4 | Domain-level: `grep -n "where:" ` in the new domain modules for queries by id without `orgId` (`findUnique({ where: { id } })` on tenant tables) | none, or each followed by an org check; list any finding |

## D. Duplicate-import prevention

| # | Check | Expected |
|---|---|---|
| D1 | Same bank statement file uploaded twice (same org, same kind) | second upload refused or pointed at the first batch (`fingerprint` unique), no second batch, no double records |
| D2 | Same statement with one transaction changed / overlapping period | new batch; overlapping transactions flagged by their per-record fingerprint, not silently imported twice |
| D3 | Same Didox invoice by upload and by pull (if the connector exists); same invoice in two different files | one batch; the second reported as duplicate |
| D4 | Same product catalogue twice; the same product in two catalogues | duplicate batch refused; products upserted once (`upsertProducts` counts updated, not created) |
| D5 | Two parallel uploads of the same file (two tabs) | exactly one batch (unique index holds; the loser gets a clean message, not a 500) |
| D6 | Export the same batch twice; retry only failed rows | second export does not duplicate rows already exported (`exported` status), `onec_export` history shows both |
| D7 | The same file in two clients of one org | behaviour stated by A1 (the unique key is per org and kind, not per client); record whether that is the intended rule |

## W. Workflows (acceptance scenarios, in-app browser, both locales, 375 px once)

| # | Scenario | Expected |
|---|---|---|
| W1 | **Product catalogue import:** upload a catalogue XLSX/CSV (`tmp/found-catalogs/test-aralash-katalog.xlsx`) under `/products` → mapping → processing → review grid (valid / corrected / suspicious / unresolved) → approve → "Prepare for 1C" → download `nomenclature_xlsx` | MXIK checks (invalid, inactive, restricted), packaging code and unit checks shown with reasons; unresolved rows not exported; file opens; history row under `/onec` |
| W2 | **Didox processing:** upload a Didox invoice (zip/JSON/XLSX fixture from A3) → lines matched to products (A4's `matchProducts`), MXIK and packaging checks → review → approve → `receipt_xlsx` | imported / skipped / rejected counts exact; duplicate-name folding visible; nothing exported without approval |
| W3 | **Bank statement processing:** upload each of A2's three layouts → mapping (auto or manual) → normalisation (dates, decimals, debit/credit) → counterparty matching → operations by rules → review → approve → `bank_exchange_1_02` | reconciliation shown (opening + credits − debits = closing); a mismatch is an error, not a silent pass |
| W4 | **1C import:** `/onec` history and detail; prepare → export → file download; re-export; connection settings page | the generated `bank_exchange_1_02` file matches A1's checked-in fixture's field set; "not tested against a real 1C" stated in the UI or docs where no environment exists |
| W5 | Loading, empty, success and failure states on each new page; uz and ru; 375 px without horizontal scroll; dark mode | `walk.mjs` with the four routes and their detail pages: no console error, no overflow, no Uzbek left in ru except data |
| W6 | Old flows unaffected: upload wizard → audit → workspace decisions → export → re-upload, clients, settings, notifications, demo, share (covered by B8) plus one manual pass of the catalogue workspace | PASS |

## U. No unsafe automatic accounting changes

| # | Check | Expected |
|---|---|---|
| U1 | Grep the new domain code for writes to `ImportRecord.status = 'exported'`, `decision`, counterparty creation, product upsert, `FirmMapping` writes: each happens only from an explicit user action (an endpoint with `role: writer`/`admin`) or is a `suggestion` | no background job or GET writes a decision, creates a counterparty in 1C terms, or exports |
| U2 | AI output (`MatchCandidate` with basis `ai`, reranker) is stored as a suggestion with confidence; `status` stays `suspicious`/`unresolved` until a decision | verified on one row per module in the browser and in the DB |
| U3 | Rows the rules cannot decide are `unresolved` with an issue code, never filled with an invented value (amount, INN, account, MXIK); every emitted issue code has uz and ru labels (`<area>X.issues.<code>`) | grep the issue codes per module against the i18n parts; a test or a list in the report |
| U4 | `transferExport` (direct 1C) is unreachable unless a connection was saved and tested by an admin; it never runs on a schedule | read code; `POST /api/onec/batches/{id}/transfer` without a connection → refused |
| U5 | Bank rules learned from a decision ("remember") apply as suggestions on the next statement, not as silent changes to past batches | browser check on W3's second statement |

## S. Security review of the integrated diff (`git diff 36ef476...HEAD`)

| # | Check | Expected |
|---|---|---|
| S1 | Secrets: `git diff 36ef476...HEAD \| grep -nE "^\+.*(api[_-]?key\|secret\|password\|token\|Bearer)" ` and a look at each hit; no `.env*` committed; no real INN/accounts/names of real companies in fixtures beyond published samples | none |
| S2 | Leftovers: `grep -nE "^\+.*(console\.(log\|debug)\|TODO\|FIXME\|XXX\|debugger\|\.only\(\|\.skip\(\|it\.todo)"` | each hit justified (operator messages, the `accounting-*.e2e.ts` skips only while routes are missing) |
| S3 | New dependencies: `git diff 36ef476...HEAD -- package.json package-lock.json` | each new package named in a result note, pinned by the lockfile, no install scripts |
| S4 | Outbound calls (Didox, 1C OData/HTTP, Tasnif): URLs come from config, cite the research note, have timeouts, never follow redirects to arbitrary hosts, never send another org's data; SSRF: a user-entered 1C URL cannot reach `localhost`/link-local/the DB (or the risk is documented) | per call site |
| S5 | File parsing of uploads (XLSX, ZIP, XML, JSON): size limits, zip-bomb limits (reuse `zip_limits`), XML external entities off, no path traversal from zip entry names | per parser |
| S6 | Logging: new log lines carry no document contents, INN/account numbers, credentials or tokens | grep the API log after W1–W4 |
| S7 | Console output in the browser during W1–W5 | no errors |
| S8 | `/api/docs` in production (Q9 after Phase B) | 404 unless enabled |

## R. Report

Deliver `docs/accounting-2026-10-23/qa-report.md`: verdict (PASS / FAIL), per item PASS/FAIL/N/A
with evidence, FAIL items with severity, owner (workstream) and proposed fix, what was not run and
why (credentials: Didox, real 1C, SMTP, Google, Telegram), environment left behind (accounts, DBs,
images, running servers). Update `agent5-result.md` (phase C).
