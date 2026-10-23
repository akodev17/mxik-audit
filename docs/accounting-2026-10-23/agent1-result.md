# Agent 1 result: 1C integration and import infrastructure (23 Oct 2026)

Branch `feat/onec-integration-core` (worktree `onec-integration-core-1f0ea3`), cut from the base
commit `36ef476`. Not pushed. Ports: API 4021, web 3021.

## Commits

| Commit | What |
|---|---|
| `735ef6f` | Domain module `packages/domain/src/onec` (prepare / build / transfer, plan, formats, counterparties, review), migration `20261101000100_onec_connection`, additive contract fields, `iconv-lite` declared |
| `ad5b3b5`, `ff177ea`+1 | Golden files, format and plan tests, fixtures and seed helpers, database tests, byte-exact golden files (`.gitattributes`) |
| `122754c` | HTTP: contract module `onec` (12 operations), Nest `OnecModule`, i18n (uz + ru), API e2e tests |
| `6f964a6` | Web: `/onec`, `/onec/[batchId]` (review grid + export panel), `/onec/settings`; seed and benchmark scripts; screenshots |
| (this commit) | Docs: this note, `onec-formats.md`, `onec-ui.md`, `handoff-agent1.md` |

## Delivered

1. **The 1C interface, real** (`packages/domain/src/onec/index.ts`, signatures of the base commit
   kept; `matchCounterparties` / `recordCounterparties` take an optional scope as a 3rd argument).
   - `prepareExport`: loads the batch's approved records (`valid`/`corrected`, or the given
     `recordIds`), validates them for the format (zod schema of the kind, real dates, positive
     amounts, the statement account, line maths), finds duplicates within the set (`duplicate_row`)
     and against exported records of the org's other batches (`duplicate_export`, per fingerprint),
     flags an identical set exported before (warning), runs the checks (bank: opening + credits −
     debits = closing and the turnover totals; invoice: lines vs header), answers issues and checks,
     writes nothing.
   - `buildExport`: same plan, builds the file, stores it on a new `onec_export` row with the
     outcome, writes each record's `outcome` (`imported` / `skipped` + reason), marks the records
     `exported`, moves the batch to `exported`, recounts, writes `AuditEvent onec.exported` — all in
     one transaction. A repeat of the same request (batch + format + record set) within 10 minutes,
     with no decision since, answers the stored export (`reused: true`). Side files (the products
     of an invoice, a statement's counterparties) leave records and batch as they are.
   - `transferExport` (OData): one POST per document, per-record `imported` (with `Ref_Key`) or
     `rejected` (reason + 1C's message); refused records stay approved for a retry.
   - `matchCounterparties` / `recordCounterparties`: ИНН → account → normalised name → alias with
     confidences per basis, ambiguity when two counterparties share a name, an ИНН that contradicts
     a name match blocks it; record creates `new` ones (once per ИНН/account/name in a call) and
     teaches matched ones their other spelling (alias) and missing ИНН/account/МФО. `normalizeName`
     folds case, ё/е, quotes and apostrophes, legal forms (ООО, MChJ, МЧЖ, ЧП, ИП, AJ, XK, YaTT,
     "Общество с ограниченной ответственностью", …) and spaces.
2. **Formats** (details and sources: `onec-formats.md`): `bank_exchange_1_02` (windows-1251, CRLF,
   Russian standard keys, МФО in `…БИК`, plus `…МФО` with the per-org option `uz_mfo`; a parser
   `parseBankExchange` for Windows/DOS/UTF-8 files and a byte-exact round trip), `nomenclature_xlsx`
   (Наименование, Код из классификатора, Код упаковки, Единица измерения, Штрихкод, Артикул),
   `receipt_xlsx` (header block + lines + totals, one sheet per invoice), `counterparties_xlsx`,
   and the catalogue's existing 1C CSV/XLSX moved into `onec/sheets.ts` (`export-1c.ts` re-exports
   them; the catalogue download is unchanged). `odata` behind `OneCConnection` (sealed password,
   object map, test of `$metadata`, 10 s timeouts, private hosts refused in production). `http`:
   connection test only. No COM.
3. **Counterparties**: matching and recording as above; `POST /api/onec/counterparties/import`
   loads a 1C «Контрагенты» export (header words in ru/uz/en), `GET /api/onec/counterparties` lists
   and searches them; `/onec/settings` has both.
4. **HTTP and web**: contract module `onec` (batches, batch, prepare, exportBatch, transfer,
   exportFile, decide, decideMany, connection, saveConnection, testConnection, counterparties,
   importCounterparties; reads `any`, decisions/exports `writer`, connection `admin`, `noDemo` on
   writes), `apps/api/src/onec`, `OnecModule` in `app.module.ts`. Web `/onec`, `/onec/[batchId]`,
   `/onec/settings`, the shared grid `apps/web/src/app/(app)/onec/review/review-grid.tsx`
   (`{ batchId, kind, columns?, readOnly? }`, documented in `onec-ui.md`). Both locales; labels for
   every generic issue code in `accountingX.issues`.
5. **Tests, seed, benchmark**: see below. `scripts/seed-accounting-demo.ts` seeds a bank, an
   invoice and a product batch for any account.
6. **Contract stewardship**: additive changes only (listed in `handoff-agent1.md`). No proposal
   from Agents 2–4 had reached me by the time of writing.

Export answers JSON, not the file: `POST …/export` → `{ exportId, filename, records, reused }`, and
the browser downloads `GET /api/onec/exports/{exportId}/file` (so the page can show the outcome and
the history keeps the file). Producing workstreams call the domain functions directly.

## Verified, and how

| What | How | Result |
|---|---|---|
| Bank file = golden file byte for byte, both key variants; round trip parse → same payments → same bytes; DOS/cp866 read; no line injection | `packages/domain/src/onec/formats.test.ts` | pass |
| XLSX formats = golden cell grids; codes are text cells; totals | same file | pass |
| Plan rules: approvals, unresolved, duplicates (row, cross-batch, same set), bad date/amount/account, balance and totals checks, unparsable payloads | same file | pass |
| Prepare/build/idempotency/duplicates/decisions/side files/counterparties/1C «Контрагенты» import, against the dev DB | `packages/domain/src/onec/export.test.ts` | pass (10) |
| OData connection save (sealed), test (auth failure, `$metadata`, missing entity sets), transfer with one refused document and its retry | same file, against a local fake OData server | pass |
| Labels for every code in uz and ru | `packages/domain/src/onec/labels.test.ts` | pass |
| HTTP: contract shapes, prepare/decide/export/download/idempotent repeat, refusals (CSRF, viewer, demo, scoped accountant, another org), connection, counterparties import | `apps/api/test/e2e/onec.test.ts` + `unit/http-wiring.test.ts` | pass (10) |
| Pages in the in-app browser on 3021 with the seeded batches: list, grid, correction in place, bulk approve, prepare checks, export history, settings and connection test, counterparties, 375 px, ru and uz, another workstream's invoice batch | screenshots `agent1/01…13` | works; bugs found and fixed on the way (duplicate breadcrumb, 5-tile stat row wrapping, grid too wide, "no change" message, duplicate № column) |
| Full suite | `npm run typecheck`, `npm run lint`, `npm test` | see "Checks" |

## Implemented but not tested against a real system

- **Every 1C file**: no real «1С:Бухгалтерия для Узбекистана» has loaded them yet. The bank file
  follows the official Russian standard; which МФО key the Uzbek edition reads is unknown (both
  variants available per org).
- **OData transfer**: tested against a fake server only. The default object map fills header
  attributes but no references (`Контрагент_Key`, `Номенклатура_Key`, bank account, operation
  kind); a real 1C will probably refuse such documents until those lookups are added against a
  real base. The UI and the API say "not verified against a real 1C" (`verifiedAgainstReal1C:
  false`).
- **HTTP transfer**: not implemented (connection test only); answers `http_transfer_unsupported`.

## Performance (1 000-record bank batch, `scripts/bench-onec-export.ts 1000 3`)

Shared dev Postgres in Docker, other sessions running; median of 3 runs
(`agent1/benchmark-2026-10-23.json`):

| Step | Run 1 (median) | Run 2 (median; after the duplicate lookup became one SQL join; the full test suite ran in parallel) |
|---|---|---|
| prepareExport (dry run, all checks) | 501 ms | 367 ms |
| buildExport (plan again + file + `onec_export` + 1 000 outcomes + batch state + audit) | 1 092 ms | 1 236 ms |
| prepare + build | 1 593 ms | 1 603 ms |
| idempotent repeat | 133 ms | 180 ms |
| prepare of a duplicate statement (1 000 × `duplicate_export`, one run) | 2 356 ms | 840 ms |
| file size | 623 KB | 623 KB |

## What the owner must provide

1. A bank statement exported from a client's 1C (or a bank's `kl_to_1c.txt` for that client) to
   settle the МФО keys and become a second golden file (`onec-formats.md` §1).
2. A test base of «1С:Бухгалтерия для Узбекистана 3.0» to load our `kl_to_1c.txt`,
   `nomenclature_xlsx` and `receipt_xlsx` once.
3. For the direct route: an OData-published base URL, a user with «УдаленныйДоступOData» (or full
   rights) and its password, and consent to create test documents there.

## Not done / follow-ups

- Reference lookups for OData (counterparty, nomenclature, bank account, operation kind) — needs
  a real base.
- Activity-log labels for `onec.*` events (request in `handoff-agent1.md`).

## Checks

(filled in below after the final run)
