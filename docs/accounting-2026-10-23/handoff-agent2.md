# Handoff from Agent 2 (bank statements) — proposals and merge notes

Branch `feat/bank-statement-automation`. Written against the base commit `36ef476` and Agent 1's
side-session note `agent1-onec-interface.md` (its branch head `8538abc` was read, not merged).

## A. Proposals for the shared contract (Agent 1 decides)

1. **Unresolved bank lines carry nulls.** A line whose date, amount or direction cannot be read is
   stored with that field `null` and an error issue (status `unresolved`), never a guessed value.
   `accounting.BankTransaction` requires all three, so `ImportRecordRow` (and the `/onec` batch
   view) would fail to parse such a record. Proposal: `date`, `amount`, `direction` nullable in
   `BankTransaction` (exporters only ever see approved records, which have all three), or a
   lenient payload for `status = unresolved`. Until then the bank module serves its own
   `BankRecordPayload` (`packages/contracts/src/modules/bank.ts`, = BankTransaction with those three
   nullable).
2. **Two optional fields on BankTransaction** the bank records already carry:
   `raw?: string[]` (the source row's cells, shown in the correction form) and
   `operationSuggestion?: MatchCandidate | null` (the AI's operation suggestion, basis `ai`, never
   applied). zod strips them today, so nothing breaks.
3. **BankStatementMeta**: the bank module writes your new optional `ownerName`, `ownerInn`, `mfo`
   (from the title rows), plus its own `bank` object (format name, verified flag, header signature,
   title lines, the bank's totals row, progress, AI usage). `counts` carries two extra keys,
   `approved` (approved and not exported) and `progress` (`{done,total}` while processing).

## B. How the bank module uses the 1C interface (please keep these true)

- **Approval:** a reviewer's approve sets `decision = {action:'approve', corrections?}` and turns a
  `suspicious` line into `valid` (your rule: you export `valid` and `corrected`). `unresolved`
  lines cannot be approved.
- **Export:** `buildExport({ format: 'bank_exchange_1_02', recordIds })` with `recordIds` = approved
  lines whose status is not `exported` — a retry never re-sends an exported line. The bank module
  does **not** mark records exported itself: it relies on `buildExport` setting
  `status = exported` and `outcome` for what it wrote (your note says the primary format does).
- **Errors:** `not_implemented` → HTTP 501 with "the 1C module is not connected yet"; any other
  `{ok:false}` → 409 with the code.
- **Counterparties:** `matchCounterparties(orgId, refs)` per chunk of 500 while reading, and again for
  a corrected counterparty; `recordCounterparties(orgId, refs)` for the lines about to be exported.
  At the merge, pass the batch's client: `{ clientId: batch.clientId }` (and `source: 'bank_statement'`
  for `recordCounterparties`) — three call sites: `packages/domain/src/bank/store.ts`
  (processStatement) and `packages/domain/src/bank/service.ts` (decideRecord, exportStatement).
  The base-commit stub takes two arguments, so I could not pass it on this branch.
- **Fingerprints:** `import_record.fingerprint` = `lineFingerprint()` (`bank/duplicates.ts`):
  SHA-256 of `ref|ourAccount|reference` when the bank gives a reference, else
  `date|amount|direction|ourAccount|docNumber|ИНН|(purpose when no doc number)`. You read stored
  fingerprints and never recompute them, so this is consistent; switching to your
  `bankFingerprint` later is a one-line change if you prefer one key everywhere.
- **Counts:** the bank module recounts with its own `recount()` (same `BatchCounts` keys plus the
  two extras). If your `refreshCounts()` replaces the object without them, the `/bank` screens fall
  back to 0 approved; please keep unknown keys or call the bank recount after an export.

## C. The shared review grid

`/bank/[batchId]` uses a local grid (`apps/web/src/app/(app)/bank/review/`), because yours was not on
this branch. Replacing it with `onec/review/review-grid.tsx` loses three bank actions that go
through `PUT /api/bank/records/{id}/decision`, not `/api/onec/.../decisions`:
the operation as an inline select (enum `BANK_OPERATIONS`), **"remember for this counterparty /
purpose"** (creates a `bank_rule` and re-applies it to the statement), and **accept the AI
suggestion**. Options at integration: give `ReviewGrid` a `rowActions`/`renderEditor` slot the bank
page fills, or keep the bank grid. Issue labels already resolve from `bankX.issues`.

## D. Coordinator: files outside my ownership I touched (all additive)

| File | Change |
|---|---|
| `packages/domain/src/spreadsheet.ts` | new export `readGrid()` (the raw grid incl. title rows); `parseUpload` now calls it, behaviour unchanged |
| `packages/db/prisma/schema.prisma` | Agent 2 section (`BankFormat`, `BankRule`); relation lines `bankFormats`/`bankRules` on `Organization`, `bankRules` on `Client` |
| `apps/api/src/app.module.ts` | `BankModule` import line |
| `.claude/launch.json` | `tasnivo-api-4022`, `tasnivo-web-3022` |
| `packages/contracts/README.md` | checklist regenerated (`npx tsx packages/contracts/src/checklist.ts --write`) — regenerate again after merging all modules |
| `tests/web-parity/bank.test.ts` | new parity test for the bank page's pure copies |
| `scripts/bench-bank.ts` | new benchmark script (no package.json entry added) |

`checklist.test.ts` requires every endpoint to name what it `replaces`; new accounting endpoints
replace nothing, so the bank entries name the page they serve (`page:(app)/bank…`). Consider
allowing a `new:` form for the programme's modules.

## E. Platform notes (for Agent 5 / coordinator)

- Prisma JSON-path filters: `NOT: { decision: { path: ['action'], equals: 'approve' } }` silently
  drops rows whose `decision` is NULL (SQL three-valued logic). The bank module ORs it with
  `decision: { equals: Prisma.AnyNull }`; anyone filtering on `import_record.decision` needs the same.
- Next.js: a server page importing a constant from a `'use client'` module gets a client reference,
  not the value (`REVIEW_FILTERS.find is not a function`). Shared constants of a page live in a
  plain module.
