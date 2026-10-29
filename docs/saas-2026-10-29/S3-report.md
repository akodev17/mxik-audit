# S3 — Audit lifecycle hardening: report (29–30 Oct 2026)

Branch `feat/s3-audit-lifecycle` (cut from `feat/saas-hardening-plan`), worktree
`.claude/worktrees/agent-a2aca03b6f709a731`. Findings F5, F6 (decision D7), F16 and the F20
restriction-source item. Not pushed, not merged.

## What was verified in the code first (29 Oct)

- F5: `loadRestricted` (`audit-runner.ts:125`, plan said 130) swallowed errors with `.catch(() => [])`;
  an empty table gave an empty map and nothing said so. **The dev database has 0 restricted codes**,
  so every dev audit so far silently skipped RESTRICTED.
- F6: a row error stopped `runPool` and failed the catalogue; `runAudit` never throws; `retryAudit`
  deleted every finding and restarted from row 0. Confirmed as described.
- F16: the heartbeat stopped in `auditCatalog`'s `finally`, before purchase/privilege/carry-over/
  auto-accept; `applyMapping` beat once at the claim; a resumed run rebuilt `pipelineMeta` from its own
  rows only. Also found: `runAudit` deleted half-written findings only when `fromRow > 0`, so a crash
  with watermark 0 and rows finished out of order would duplicate findings on resume (fixed: always
  delete at/after the resume row).
- The plan names `apps/web/src/lib/catalogs/classifier-health.ts`; it does not exist. The "classifier
  health view" is `/api/health` (`packages/domain/src/classifier-health.ts`) and the operator lines of
  `/admin` (`packages/domain/src/pipeline-status.ts`). Both got the item.

## What changed

**Per-row retry and failed rows (F6, D7)**
- New `packages/domain/src/row-retry.ts`: `withRowRetry` (first try + 3 retries after 0.5 s / 2 s / 5 s),
  `checkErrorText` (`"<kind>: <first line>"`, ≤300 chars), kinds `timeout | database | other`.
- `audit-runner.ts`: each row is checked inside the retry; its findings, `markingRequired` and the
  cleared `checkError` are written in one transaction. A row that still fails gets
  `CatalogItem.checkError` and the run goes on; if even that write fails the audit fails as before
  (a row is never left looking checked, never turned into "ok"). Rows below the resume point with
  `checkError` are checked again on any resume or re-check, without moving the watermark back.
- `pipelineMeta.rowsFailed` (counted from the database at the end) and degraded code `rows_failed`.
- Migration `packages/db/prisma/migrations/20261108000200_item_check_error/` (nullable column, no
  backfill); rollback note in `docs/accounting-2026-10-23/migrations.md`. Applied to the dev DB with
  `npx prisma migrate deploy`.
- `retryAudit` = "re-check failed rows": one `updateMany` claim from `failed`, or from `ready` when a
  row has `checkError`, to `analyzing`; continues only when `count === 1`. It enqueues from the stored
  watermark (`progressDone`): a ready catalogue re-checks only its failed rows, a failed one resumes.
  No finding or decision is deleted.
- Test seam: `injectRowFault()` (tests) and `AUDIT_FAULT_ROWS=<text>` (ignored when
  `NODE_ENV=production`) make chosen rows throw; `setRowRetryDelays()` shortens the waits in tests.

**Restricted list (F5)**
- `loadRestricted` no longer swallows errors; `auditContext` logs a read failure with `console.error`
  and, when the list is empty or unreadable, records `restricted_unchecked` (setup field
  `restrictedCodes`). New `restricted-state.ts`: codes loaded + newest `importedAt`.
- `/api/health` `classifier.restricted: { codes, importedAt } | null`; `/admin` gets a line
  "Cheklangan kodlar (EHF): N ta kod · yuklangan <date>", or "yuklanmagan · npm run load:restricted".
- Banner text (uz/ru) for `restricted_unchecked`; an org admin also sees "Administrator uchun:
  roʻyxatni serverda npm run load:restricted buyrugʻi bilan yuklang…".

**Heartbeat and resume (F16)**
- `runAudit` starts the heartbeat itself and stops it only after `ready` is written (or on failure);
  the beat now carries the pipeline metadata of exactly the rows below the watermark.
- `startHeartbeat`: a beat still waiting is not stacked with another; `stop()` waits for an in-flight
  beat. `applyMapping` beats during the rebuild (only the claim/try/finally lines of `catalog-import.ts`).
- Resume merges counters: `pipelineMeta.throughRow` says which rows the stored counters cover;
  `resumeCounters` uses them only when the run starts exactly there.

**Workspace and drawer**
- Filter value `FAILED` ("Texnik xato" / "Техническая ошибка") in `workspace-filter.ts` and the web copy
  `lib/workspace-url.ts`; the chip shows when `summary.failedRows > 0`. Because failed rows have no
  findings, `?type=FAILED` renders a list of those rows (row, name, current code, reason) with
  "Xato qatorlarni qayta tekshirish"; new endpoint `GET /api/catalogs/{id}/failed-rows` (first 500,
  scoped like every catalogue read, 404 for another org).
- `checkError` (the kind) is in `GridRow` and `RowDetail`; the drawer shows a danger line when the row's
  own check failed (e.g. a purchase finding on a failed row). Wave-2 export work can print "not checked"
  from `catalog_item."checkError"` directly.
- The customer sees the kind in their language, not the raw message (it can carry SQL or provider
  text, as `CatalogStatus` already decided for `auditError`); the raw first line stays in the column
  and the server log.

**Restriction source (F20)**
- `RowDetail.facts.restriction.source` (looked up from `restricted_code.source`); the drawer adds
  "Manba: tasnif.soliq.uz/news/5063; kuchga kirish sanasi: 01.07.2026." / "Источник: …; дата вступления
  в силу: …". No schema change on `finding`.

**Robustness found during the smoke**
- The shared dev Postgres crashed into recovery mode twice during the run (`server process … was
  terminated by signal 13`, `exited with exit code 2` in `docker logs mxik-audit-db`); not caused by
  this change. The first crash killed the API process with an unhandled `error` event from a checked-out
  `pg` client. The classifier pool in `audit-runner.ts` now logs connection errors (pool and every
  client) instead of crashing; the next query fails and the row retry takes a fresh connection.

## Files

Domain: `audit-runner.ts`, `audit-jobs.ts`, `audit-heartbeat.ts` (+test), `pipeline-meta.ts` (+test),
`row-retry.ts` (new), `restricted-state.ts` (new), `classifier-health.ts` (+test), `pipeline-status.ts`
(+test), `catalog-import.ts` (heartbeat lines), `workspace.ts`, `workspace-filter.ts` (filter value),
`workspace-rows.ts` (one field), `row-detail.ts`, `row-detail-parts.ts` (+test; type and one line),
`audit-jobs.test.ts`. DB: `schema.prisma` (CatalogItem), migration. Contracts: `catalogs.ts`,
`workspace.ts`, `health.ts`. API: `workspace.controller.ts` (failed-rows), `health.controller.ts`.
Web: `catalogs/[id]/{workspace-header,page,filter-chips,drawer-body (one line + import),reason-text
(+test),ws-types,failed-rows (new)}`, `lib/catalogs/report.ts`, `lib/workspace-url.ts`. i18n:
`matching.ts`, `workspace.ts`. Tests: `apps/worker/src/worker.test.ts`, `tests/web-parity/*`.
Not touched: `catalog-pages.ts`, `decisions.ts`, `versions.ts`, `dictionary*.ts`, export files.

## How it was tested

- `npx tsx --test packages/domain/src/audit-jobs.test.ts` (dev DB): all new cases pass —
  row-level throw → `ready`, `checkError = "other: provider exploded"`, no findings on that row,
  `rowsFailed 1`, `rows_failed`, summary/failed list, another org gets null; a row failing twice then
  succeeding is checked normally; three concurrent `retryAudit` calls → exactly one claim, the failed row
  re-checked, a decision on another row kept, `rowsAudited 2`, a second retry refused; resume keeps the
  stored counts (`rowsAudited 2`, `vector_failed` kept, `fromRow 1`); a stale sweep (`resumeStaleAudits(4000)`)
  during a post phase held 5 s by a row lock returns 0 with a fresh heartbeat; empty restricted table →
  `restricted_unchecked`. In one run under heavy machine load the two old cases ("returns at once",
  "resumes an orphaned audit") hit the test's own 120 s wait; rerun alone they pass (55 s each).
- Pure tests: `pipeline-meta`, `pipeline-status`, `classifier-health`, `row-detail-parts`,
  `reason-text`, web-parity (`degradedNotes`, `readFilter` with `FAILED`) pass.
- `apps/worker/src/worker.test.ts`: new case added (row fault through BullMQ → `ready` + `rows_failed`);
  **skipped here: no Redis on 127.0.0.1:6379** (only the db container runs; not started per the rules).
- 2,000-row smoke (API inline on 4053 with `AUDIT_FAULT_ROWS=SINOV-XATO`, web on 3053): synthetic xlsx
  uploaded and committed through the API with a test org; 3 injected rows (350, 1050, 1750). Postgres
  crashed mid-run and took the API down at row 511; on restart the progress read resumed it from 511;
  result `ready`, `degradedReasons ["rerank_off","restricted_unchecked","rows_failed"]`,
  `rowsAudited 1997` (counts from both runs merged), `rowsFailed 3`, `failedRows 3`; the workspace HTML
  has the banner ("3 ta qator texnik xato tufayli tekshirilmadi…", the restricted sentence, the admin
  `npm run load:restricted` line), the "Texnik xato" chip and link; `?type=FAILED` lists the 3 rows
  with "Tekshiruv kutilmagan xato bilan toʻxtadi." and the re-check button. API restarted without the
  fault, `POST /retry` → `ok`, then `ready`, `rowsAudited 2000`, `rowsFailed 0`, no `rows_failed`.
  Pages were checked by fetching the server-rendered HTML (the Browser pane refused localhost here).
  The smoke orgs were deleted afterwards; scratch scripts are not committed.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0 (one pre-existing warning,
  `scripts/lib/xlsx.ts:131` non-null assertion).
- `npm test` (final run, 30 Oct): 2027 tests, 2023 pass, 3 skipped (Redis not reachable: 
  `RedisRateLimitStore`, `/api/v1 with REDIS_URL`, `worker (Redis + database)`), **1 fail**:
  `apps/api/test/e2e/imports.test.ts:85` "cheques: … it finishes …" — `timed out waiting for the
  cheque check` (its own 120 s wait). It passes when run alone on this branch
  (`npx tsx --test apps/api/test/e2e/imports.test.ts`: 5/5, the cheque case in 20 s); in the full run
  the doc check competes with every other suite and five sibling sessions on one machine and one
  Postgres. An earlier full run broke on the Postgres crash (dozens of "database system is in recovery
  mode" failures) and on my own expectations (admin pipeline now 4 lines, workspace 42 operations,
  health fixtures, the generated contracts checklist); those were fixed in `cf11935`.

## Open points for the owner

1. The dev database has no restricted list: run `npm run load:restricted` (and on production) — until
   then every audit carries "restricted list not checked".
2. Failed rows show the kind of error, not the raw text, to customers (consistent with `auditError`).
   Say if accountants should see the raw first line.
3. Re-check reruns the purchase/privilege/carry-over/auto-accept phase for the whole catalogue (each
   replaces only pending findings, decisions are kept); pending purchase/privilege findings get new ids,
   so comments on those pending findings would go with them, as on any resume today.
4. A run where every row fails (e.g. the classifier tables unreachable but the main DB up) ends `ready`
   with all rows in `rows_failed`; there is no circuit breaker that fails the audit instead.
5. Postgres in the dev container crashes under the parallel load (signal 13 / exit code 2 backends);
   worth a look before the overnight 60k run.
6. Worker test needs Redis (`docker compose up -d redis`) to run its new case.
