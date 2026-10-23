# Tasnivo accounting automation programme, 23 Oct 2026: plan, contracts, coordination

Five Claude Opus sessions, each on its own branch and worktree, coordinated from one Fable
session. This file is the contract every session works to. It extends, and does not replace,
`docs/BUGFIX_PLAN_2026-10-23.md` (whose ground rules still apply) and `docs/HANDOFF_2026-10-23.md`.

## 0. The customer outcome

Accountants in Uzbekistan spend hours re-typing three kinds of source data into 1C
(«1С:Бухгалтерия 8 для Узбекистана»): incoming invoices from Didox, bank statements (выписка /
оборотка) downloaded as Excel, and product catalogues whose MXIK (ИКПУ) codes and packaging codes
must be right before the invoice can be entered. Tasnivo already audits MXIK codes in a catalogue.
This programme turns it into one workflow:

```
source in (upload or pull) → parse → match against known records → validate → review exceptions
→ approve → 1C import file or direct transfer → reconcile and keep history
```

Not in scope: anything that is not on that path (no general ledger, no payroll, no reporting
suite, no redesign of unrelated screens). Where an external interface (Didox API, direct 1C
access, Tasnif API) cannot be reached from this machine, the independent part is built and the
fallback (file upload, file export) is the deliverable; the report says which is which.

## 1. Where the repository stands (inspected 23 Oct, 16:00)

- `main` = `384ab76`. The bug-fix programme of the morning finished: Agent 4's integration branch
  `claude/agent4-integration-d41667` (`fb50942`) carries mandatory e-mail code verification, Google
  and Telegram sign-in, the durable trial-quota ledger, 19 bug fixes and six cross-cutting fixes;
  Agent 5's QA report (`docs/bugfix-2026-10-23/qa-report.md`) is **PASS** with five non-blocking
  items (FAIL-1…5). It was never pushed: the owner's rule is "push only when authorised".
- **Base branch of this programme:** `integration/tasnivo-2026-10`, cut from the QA branch
  (`4512c0b`, which contains `fb50942`) with `main` merged, plus the base commit described in §4.
  Every workstream branch is cut from the base commit. The final integration lands on this branch.
- Stack: npm-workspaces monorepo, `apps/api` (NestJS, :4000), `apps/web` (Next.js, no DB access,
  calls the API through `@tasnivo/api-client`), `apps/worker` (BullMQ), `packages/{contracts,
  domain, core, db, i18n, api-client}`. Prisma schema in `packages/db/prisma/schema.prisma`.
  Read `docs/HANDOFF_2026-10-23.md` §2–3 and `apps/api/README.md` before coding.
- What exists today for the three workflows: XLSX/CSV catalogue import (`packages/domain/src/
  spreadsheet.ts`, `column-map.ts`, `mapping-guess.ts`, `mapping-memory.ts`, `catalog-upload.ts`),
  the MXIK matching engine (`packages/core/src/match`, 7-stage cascade, firm dictionary in
  `FirmMapping`), an audit workspace with decisions, a "1C file" export that is a plain
  spreadsheet for 1C's "load from table" processing (`packages/domain/src/export-1c.ts`), a
  purchase-list and cheque/sales-list import (`list-upload.ts`, `DocList`), the public API v1,
  Tasnif scripts (`scripts/fetch-catalog.ts` etc. against `https://tasnif.soliq.uz/api/cls-api`).
  **Nothing** exists for Didox, bank statements, counterparties, or a 1C exchange format.
- What was researched about the external systems: `docs/accounting-2026-10-23/integration-research.md`
  (official vs third-party vs unknown, per system). Read it before designing a connector.

## 2. Workstreams, branches, ports

| Agent | Branch | Worktree slug | API / web ports | Migration prefix |
|---|---|---|---|---|
| 1 1C integration and import infrastructure | `feat/onec-integration-core` | `onec-integration-core` | 4021 / 3021 | `202611010*` |
| 2 Bank statement Excel → 1C | `feat/bank-statement-automation` | `bank-statement-automation` | 4022 / 3022 | `202611020*` |
| 3 Didox invoice → 1C | `feat/didox-invoice-automation` | `didox-invoice-automation` | 4023 / 3023 | `202611030*` |
| 4 MXIK intelligence and product catalogue | `feat/mxik-product-intelligence` | `mxik-product-intelligence` | 4024 / 3024 | `202611040*` |
| 5 Platform bug audit, auth, regression | `fix/platform-quality` | `platform-quality` | 4025 / 3025 | `202611050*` |

The app's session tool names worktree branches with its own prefix; each session's first
commit renames its branch to the name above (`git branch -m <name>`). Migration folders are
`<prefix><seq>_<name>` (for example `20261102000100_bank_formats`) so they never collide and sort
after the base commit's `20261101000000_accounting_shared`.

Ground rules, in addition to `BUGFIX_PLAN` §3 (worktree setup `cp ../../../.env .env`, `npm ci`,
`npx prisma generate`; shared dev Postgres on 54329 with `&connection_limit=4`; additive migrations
only, `migrate deploy` never `migrate dev`; add your ports to `.claude/launch.json`; commit early,
never push, never touch `main` or the base branch):

- **Own only your files.** The ownership table in §6 says who edits what. If you need a change in
  another workstream's file, write it in `docs/accounting-2026-10-23/handoff-<agent>.md` on your
  branch and continue with a local shim if you must; the coordinator routes it.
- **Shared schema and contract are frozen except by Agent 1.** `packages/contracts/src/accounting.ts`
  and the shared Prisma models (§4) change only on Agent 1's branch; others send proposals through
  the handoff file (Agent 1 answers within the same day by committing or declining).
- **Honesty about integrations.** Code that talks to Didox, 1C or Tasnif over the network is
  "implemented" until it has run against the real system; the result note says which. Never invent
  endpoints; cite the research note or the official document for every one you use.
- **No invented accounting values.** A row the rules cannot decide is `unresolved` with an issue
  code; AI output is a `suggestion` with a confidence, never applied without a decision.
- **Report format** as in `BUGFIX_PLAN` §3, written to `docs/accounting-2026-10-23/agent<N>-result.md`
  on your branch: branch, commits, what was verified and how (tests, screenshots under
  `docs/accounting-2026-10-23/agent<N>/`), what is not done, what the owner must provide, measured
  performance numbers where the brief asks for them.

## 3. Sequence and dependencies

```
base commit (shared schema + contract + module slots) ─┬─► A1 1C core ────────────────┐
                                                       ├─► A2 bank statements ────────┤
                                                       ├─► A3 Didox invoices ─────────┼─► coordinator merges 1→4→2→3→5 on integration/tasnivo-2026-10
                                                       ├─► A4 MXIK + products ────────┤   → full checks, benchmarks, diff review, final report
                                                       └─► A5 bug audit → fix session ┘   → owner authorises push
```

- Agents 2, 3 and 4 code against the base commit's contract and tables from the first hour; they
  do not wait for Agent 1. They **must not** write their own 1C file builders: they produce
  `ImportRecord` rows and call Agent 1's `prepareExport` / `buildExport` (§4.3) through the
  interface stub that the base commit ships in `packages/domain/src/onec/index.ts`. Until Agent 1's
  real implementation is merged, the stub answers `{ ok: false, error: 'not_implemented' }`, and the
  producing workstream's tests assert on the records it wrote, not on the 1C file.
- Agent 4 provides two functions Agent 3 needs: `matchProducts()` and `classifyProducts()`
  (§4.4). The base commit ships their signatures as stubs in `packages/domain/src/products/index.ts`
  that answer `status: 'unknown'`; Agent 3 codes against them and Agent 4 fills them in.
- Agent 5's Phase A (discovery) runs at once on the base commit; its Phase B fix session starts when
  the list is written, and its Phase C regression runs on the integration branch after the merge.

## 4. Shared data contracts (base commit, owner Agent 1)

### 4.1 Prisma (additive; `packages/db/prisma/schema.prisma`, section "Accounting workflows")

| Model / table | Purpose |
|---|---|
| `ImportBatch` (`import_batch`) | One source: a bank statement file, one Didox invoice, one product catalogue. `kind` (ImportKind), `source`, `filename`, `externalRef`, `fingerprint` (SHA-256 of the bytes or the normalised document; **unique per org and kind** = duplicate-import guard), `status` (ImportStatus: uploaded → parsed → review → approved → exported, failed), `counts` (BatchCounts), `meta` (kind-specific header: BankStatementMeta / IncomingInvoiceMeta / ProductCatalogMeta), `clientId` nullable. |
| `ImportRecord` (`import_record`) | One normalised record of a batch: `payload` is BankTransaction / InvoiceLine / ProductRecord by kind, `issues` ValidationIssue[], `status` (RecordStatus: valid, corrected, suspicious, unresolved, skipped, exported), `fingerprint` (per-record duplicate key), `decision` ReviewDecision, `outcome` RecordOutcome. |
| `Counterparty` (`counterparty`) | The org's known counterparties: `inn`, `name`, `normalizedName`, `account`, `mfo`, `aliases[]`, `onecRef`, `source`. Matched by inn → account → normalised name → alias. |
| `OneCExport` (`onec_export`) | One generated 1C import of a batch (`format`, `filename`, `recordCount`, `outcome` ImportOutcome). A batch may export more than once (retry of failed rows). |

Each workstream appends its own models **inside its own marked section** at the end of the schema
(the markers are in the file) so the sections merge cleanly. Expected additions: Agent 1
`OneCConnection` (per-org connection settings, secret sealed with `SESSION_SECRET` like the 2FA
secrets); Agent 2 `BankFormat` (per-org saved column mapping per bank / header signature) and
`BankRule` (deterministic purpose → operation rules); Agent 3 `DidoxConnection`, `DidoxDocument`
(raw document cache keyed by Didox id); Agent 4 `Product`, `ProductAlias`, `PackagingCode`
(Tasnif packaging codes), `ProductMxikMapping` only if `FirmMapping` cannot carry it (prefer
`FirmMapping`).

### 4.2 Zod (`packages/contracts/src/accounting.ts`, exported as `accounting`)

The record shapes (`BankTransaction`, `InvoiceLine`, `ProductRecord`), their headers
(`BankStatementMeta`, `IncomingInvoiceMeta`, `ProductCatalogMeta`), `CounterpartyRef`,
`ValidationIssue` (machine `code` + severity + field + params + suggestion), `MatchResult` /
`MatchCandidate` (status matched / ambiguous / new / unknown, basis from `MATCH_BASES`),
`ReviewDecision`, `RecordOutcome`, `ImportOutcome`, `BatchCounts`, `ImportBatchRow`,
`ImportRecordRow`. Money and quantities are decimal strings; dates are `YYYY-MM-DD`.
Issue codes are free strings but every code a workstream emits must have a label in its i18n
part (`<area>X.issues.<code>`) in uz and ru, and be listed in that workstream's result note.

### 4.3 The 1C interface (Agent 1 implements; `packages/domain/src/onec/`)

```ts
// packages/domain/src/onec/index.ts (base commit: stub; Agent 1: real)
export type PrepareInput = { orgId: string; batchId: string; format: OneCFormat; recordIds?: string[] };
export type Prepared = { ok: true; records: number; issues: ValidationIssue[]; checks: ImportOutcome['checks'] } | { ok: false; error: string };
export function prepareExport(input: PrepareInput): Promise<Prepared>;          // validates, dedupes, reports what would go
export function buildExport(input: PrepareInput & { actorId: string }): Promise<{ ok: true; exportId: string; file: FileOut } | { ok: false; error: string }>;
export function transferExport(input: PrepareInput & { actorId: string }): Promise<{ ok: true; exportId: string; outcome: ImportOutcome } | { ok: false; error: string }>; // direct connector only
export function recordCounterparties(orgId: string, refs: CounterpartyRef[]): Promise<CounterpartyRef[]>; // match or create, returns ids
export function matchCounterparties(orgId: string, refs: CounterpartyRef[]): Promise<CounterpartyRef[]>;  // match only
```

Formats (from `ONEC_FORMATS`): `bank_exchange_1_02` (the text format 1CClientBankExchange that
«Банк и касса → Банковские выписки → Загрузить» reads; Agent 1 verifies the Uzbek edition's field
set from the research note and from any sample the owner can provide), `nomenclature_xlsx`
(products for «Номенклатура → Загрузить из файла», ИКПУ + код упаковки + единица + штрихкод),
`receipt_xlsx` (an incoming-invoice lines sheet for «Поступление товаров и услуг» loading),
`counterparties_xlsx`, and `odata` / `http` for a direct connection when the owner's 1C exposes one
(Priority 2; implemented behind `OneCConnection`, only reported as working after a real test).

HTTP (module `onec`, `packages/contracts/src/modules/onec.ts`): `GET /api/onec/batches` (history,
filter by kind/status/client), `GET /api/onec/batches/{batchId}` (batch + records page),
`POST /api/onec/batches/{batchId}/prepare`, `POST /api/onec/batches/{batchId}/export` (file),
`POST /api/onec/batches/{batchId}/transfer`, `GET /api/onec/exports/{exportId}/file`,
`PUT /api/onec/records/{recordId}/decision`, `POST /api/onec/batches/{batchId}/decisions` (bulk),
`GET/PUT /api/onec/connection`, `POST /api/onec/connection/test`. Web: `/onec` (history and
detail pages, the shared review grid component `apps/web/src/app/(app)/onec/review/` that the bank
and Didox pages embed).

### 4.4 The product intelligence interface (Agent 4 implements; `packages/domain/src/products/`)

```ts
export type ProductQuery = { name: string; mxik?: string | null; barcode?: string | null; unit?: string | null; packageCode?: string | null };
export function matchProducts(orgId: string, clientId: string | null, lines: ProductQuery[]): Promise<MatchResult[]>; // against the org's Product table + FirmMapping
export function classifyProducts(orgId: string, lines: ProductQuery[]): Promise<Array<Pick<ProductRecord, 'mxik' | 'mxikName' | 'mxikStatus' | 'mxikSuggestion' | 'packageCode' | 'packageName' | 'markingRequired'>>>; // validity + suggestion from the classifier
export function upsertProducts(orgId: string, clientId: string | null, records: ProductRecord[], actorId: string): Promise<{ created: number; updated: number; ids: string[] }>;
```

Agent 3 calls `matchProducts` for every invoice line and `classifyProducts` for lines whose MXIK is
missing or doubtful. Agent 4 reuses `packages/core/src/match` (deterministic stages first; the LLM
reranker only for ambiguous rows, as today) and the `FirmMapping` dictionary for confirmed mappings.

### 4.5 Module slots already in the base commit

- Contracts: `MODULES` has `onec`, `bank`, `didox`, `products`; empty modules exist under
  `packages/contracts/src/modules/`; the registry lists them. Fill your own file only.
- i18n: `packages/i18n/src/i18n-parts/{accounting,onec,bank,didox,products}.ts` exist and are in
  `index.ts`. `accounting.ts` (shared labels: nav, statuses) is Agent 1's; the other four are each
  workstream's own.
- Web: nav group "accounting" with `/bank`, `/didox`, `/products`, `/onec` and a placeholder page
  for each; replace your own `page.tsx`. Paths are in `CLIENT_LISTS` (client filter via `?client=`).
- API: add your Nest module folder (`apps/api/src/<module>/`) and one import line in
  `apps/api/src/app.module.ts` (expect a trivial merge conflict there; the coordinator resolves it).
- Domain stubs: `packages/domain/src/onec/index.ts`, `packages/domain/src/products/index.ts`.

## 5. One coherent product (UI rules for every workstream)

Keep the current design language (`docs/DESIGN_SYSTEM.md`, primitives in `apps/web/src/ui`). The
flow on every module page is the same: upload or pull → file preview and column mapping (reuse
`_manage/file-drop`, `preview-table`, `column-select`, `stepper`) → processing with progress
(`progress`, polling like the upload wizard) → review grid with statuses valid / corrected /
suspicious / unresolved (shared component from Agent 1, `onec/review`) → approve (bulk and single)
→ "Prepare for 1C" → download or transfer → history row under `/onec`. Every proposed change shows
its explanation (`MatchCandidate.reason`, `ValidationIssue`). Loading, empty, success and failure
states on every page; both locales; mobile width not broken. No new primitives without listing them
in the result note.

## 6. File ownership and conflict map

| Area | Owner | Others |
|---|---|---|
| `packages/contracts/src/accounting.ts`, shared Prisma models, `packages/domain/src/onec/**`, `apps/api/src/onec/**`, `apps/web/src/app/(app)/onec/**`, `i18n-parts/accounting.ts`, `onec.ts` | A1 | read only; proposals via handoff |
| `packages/domain/src/bank/**`, `apps/api/src/bank/**`, `apps/web/src/app/(app)/bank/**`, `contracts/modules/bank.ts`, `i18n-parts/bank.ts`, Prisma section "Agent 2" | A2 | — |
| `packages/domain/src/didox/**`, `apps/api/src/didox/**`, `apps/web/src/app/(app)/didox/**`, `contracts/modules/didox.ts`, `i18n-parts/didox.ts`, Prisma section "Agent 3" | A3 | — |
| `packages/domain/src/products/**`, `apps/api/src/products/**`, `apps/web/src/app/(app)/products/**`, `contracts/modules/products.ts`, `i18n-parts/products.ts`, Prisma section "Agent 4", `packages/core/src/match/**`, `packages/core/src/audit/**`, `scripts/fetch-catalog.ts`, `update-classifier.ts`, `packages/domain/src/classifier-*.ts`, `dictionary*.ts`, `export-1c.ts` (only to route it through A1's builders) | A4 | — |
| Everything else that is a bug: auth, sessions, trial, upload wizard, workspace, settings, team, billing, e2e | A5 | A1–A4 write platform bugs they hit into their handoff file |
| `apps/api/src/app.module.ts`, `package.json` (+lockfile), `.claude/launch.json`, `packages/db/prisma/schema.prisma` outside your section, `i18n-parts/index.ts`, `nav.ts` | coordinator at merge | one-line additions only |

Known collision points and how the coordinator resolves them: `app.module.ts` (union of imports),
`launch.json` (union by name), `package.json` scripts and dependencies (union; lockfile regenerated
with `npm install`), `schema.prisma` relation lists on `Organization` / `Client` (union), migration
folder order (prefixes above), `nav.ts` only if a workstream needs a sub-route.

## 7. Acceptance per workstream (summary; the full brief is in each session)

- **A1:** a verified `bank_exchange_1_02` file that 1C's bank-statement loader accepts (field set
  documented with its source; a fixture file checked in), `nomenclature_xlsx` and `receipt_xlsx`
  builders, the history/review pages, duplicate and idempotency checks, direct connector behind
  settings with an honest "not tested against a real 1C" flag if no environment exists.
- **A2:** at least three real bank layouts parsed by fixtures (the owner's samples if provided,
  otherwise published layouts named in the research note) plus manual mapping for any other,
  normalisation (dates, decimals, debit/credit), counterparty matching, duplicate statement and
  duplicate row detection, rule-based operation assignment with remembered rules, review, export
  through A1, reconciliation report (opening + credits − debits = closing), 1 000-row benchmark.
- **A3:** Didox API client (if the owner provides credentials) and the zip/JSON/XLSX upload
  fallback, header and lines extracted, product matching through A4 with duplicate-name folding,
  MXIK and packaging checks, review, export through A1, duplicate invoice detection, exact
  imported/skipped/rejected report, benchmark on a 100-line invoice and a 1 000-line batch.
- **A4:** Tasnif catalogue access verified (API or download, documented), Product table and
  catalogue import (XLSX/CSV/1C export) with matching by MXIK / barcode / name / alias, inactive /
  invalid / restricted / suspicious detection, packaging-code and unit consistency checks, confirmed
  mappings reused from `FirmMapping`, `matchProducts` / `classifyProducts` / `upsertProducts`
  implemented with tests and a 1 000-row benchmark, export through A1.
- **A5:** Phase A bug list (`docs/accounting-2026-10-23/bugs.md`) incl. re-verification of the
  three known bugs on the base branch and the five QA FAIL items; Phase B fix session with
  regression tests; Phase C regression on the integration branch with a PASS/FAIL report.

## 8. Definition of done (programme)

Every item of the owner's "Definition of Done" (brief §8) mapped to evidence: tests named, screenshots
under `docs/accounting-2026-10-23/`, benchmark numbers in `docs/accounting-2026-10-23/benchmarks.md`,
blocked items and required credentials listed in `docs/accounting-2026-10-23/FINAL_REPORT.md`. Checks
on the integration branch: `npm run typecheck`, `npm run lint`, `npm test` (with and without Redis),
`npm run test:e2e` on a production build, `npm run build`, `build:api`, `build:worker`,
`prisma migrate deploy` on an empty DB and on the dev DB. Push to `main` only on the owner's word.
