# S8 — Export completeness and import error report: report

Branch `feat/s8-export-completeness` (cut from `main` at `cf4c755`), worktree
`.claude/worktrees/agent-a50e2aa1dffc98a83`. Findings F7 (High) and the F20 items: per-row
error report, mapping edits lost on diagnose, same file charged twice, non-streaming export. Also
S6's open item (`cellsPastColumnLimit` in the wizard). Not pushed, not merged.

## Checked in the code first (30 Oct)

- **F7 is as described.** `applyMapping` (`catalog-import.ts`, now around line 180) deleted every
  item and recreated only the rows with a name. Nameless rows lost their original cells.
  `exportItems` and `catalogExport` wrote only items, with no marker or count.
- **Rows whose check failed were exported as clean.** A failed row (S3's `checkError`) has no
  findings, so `effectiveRow` said `ok` and the corrected file printed "Xavf topilmadi" for a row
  that was never checked.
- **Mapping lost.** `diagnoseCatalogUpload` only computed diagnostics; it saved nothing. The
  wizard kept the mapping in React state only. A refresh, or coming back through
  `/upload?catalog=`, showed the first suggestion again (`uploadPreview` reads
  `catalog.columnMap`).
- **No hash existed.** Nothing in `catalog-upload.ts` or the schema hashed the file.
- **No "stored sheet" for catalogues.** The plan offers "the skipped originals kept in the
  batch's stored sheet" as one option, but that exists only for bank batches. For catalogues, the
  rows live only as `catalog_item.attrs.original`.
- **"Truncated cells."** No reader cuts a cell short. I read this as the two things the reader
  leaves unread: rows past `MAX_ROWS` (`parse.truncated`) and cells past `MAX_COLUMNS`
  (`cellsPastColumnLimit`). Each gets one line in the CSV.

## What was done

### 1. F7: every input row in the export

**Storage chosen: a new table `catalog_skipped_row`** (`catalogId`, `rowIndex`, `reason`,
`original` jsonb; primary key `(catalogId, rowIndex)`; cascades with the catalogue). Migration
`20261108000700_skipped_rows_file_hash`, applied to the dev DB with `npx prisma migrate deploy`.
The rollback note is in `docs/accounting-2026-10-23/migrations.md`.

Why not the two options in the brief:

- **`CatalogItem.skipReason`.** Keeping the rows as items means about 80 queries in 45 files read
  `catalog_item` and would have to exclude them: the audit runner, workspace grid and counts,
  summary, diff and versions, dictionary, carry-over, purchases, privileges, report, dashboard
  (S9's file) and the public API. Missing one would audit empty names or count them as products.
- **Skipped originals in a stored sheet.** For catalogues there is no stored sheet.
- **A JSON column on `catalog`.** Rejected because `visibleCatalog` and others read the whole
  catalogue row without a `select`, so every header read would load it.

A separate table is read by exactly two things: the export and the issues CSV.

How it works:

- **Commit.** `applyMapping` writes the skipped rows in the same transaction as the items and
  returns `{ rows, skipped }`. Item `rowIndex` already kept the file position, so the export
  merges the two lists in file order (`inFileOrder` in `export-rows.ts`).
- **Corrected Excel.** A nameless row is written exactly as it came: the MXIK and unit columns
  get the file's own cell back. The status column reads "Tekshirilmadi: nomi yoʻq" / "Не
  проверено: нет наименования".
- **Failed check.** A row with `checkError` keeps its effective code (the file's own, or a code a
  person accepted). Its status reads "Tekshirilmadi: texnik xato" / "Не проверено: техническая
  ошибка", never "no risk" or "accepted".
- **1C files.** The 1C CSV and xlsx carry the same rows and markers. A skipped row has an empty
  name and the file's barcode. See open question 1.
- **Counts.**
  - The commit answer has `skipped`: contract `commit.response`, with a default of 0 for older
    answers.
  - The workspace header (`catalogs.get.skippedRows`, shown in the metadata line) says, for
    example, "2 qator nomsiz: tekshirilmadi, eksportda belgilangan".
  - The `catalog.exported` audit event has `skippedRows` and `failedRows`.
  - The diagnostics, the done step and the PDF already showed `noName`. The confirm step's text
    now says the rows stay in the corrected file with the marker.
- **Retention.** The retention job (`security/account.ts` `blank`) blanks the unmapped cells of
  skipped rows the same way it does for items. Without this, the new table would have been a
  privacy regression.
- **Other upload paths.** Telegram and the public API also go through `applyMapping`, so they
  keep skipped rows too.

### 2. Per-row error report (CSV)

- **The walk.** `import-diagnostics.ts` now has one walk, `eachImportIssue`, that yields every
  issue cell by cell. `importDiagnostics` counts from it, so the panel and the CSV cannot drift
  apart (a test checks this). The counts are unchanged, and the existing tests pass.
- **The builder.** New pure `import-issues-csv.ts`. One line per problem cell with these columns:
  - file line as Excel shows it (from `lineJumps`; empty when unknown);
  - data row;
  - column header;
  - reason, in the reader's language;
  - the cell as read.
- **Reasons covered:** no name, duplicate (names the line it repeats), placeholder code, wrong
  length, 16-digit lost zero, bad or zero-restored TN VED, ambiguous amount. Rows past the row
  limit get one line, and cells past the column limit get one line.
- **File format.** UTF-8 with a BOM and CRLF line ends. Every cell is formula-safe, and digit
  strings are written as `="..."` so Excel keeps them as text.
- **Endpoint.** `GET /api/catalogs/{catalogId}/import-issues`, a file download.
  - Uses the current mapping: the last one diagnose stored, or the committed one.
  - Reads all file rows (items and skipped rows merged), so it gives the same report before and
    after the commit.
  - Scoped by `catalogScope`; another org's or client's catalogue is a 404. Role `any`.
  - Lives in the contract and `exports.controller.ts`; `packages/contracts/README.md` was
    regenerated (245 operations).
- **Wizard.** `diagnostics-panel.tsx` shows "Muammoli qatorlar roʻyxati (CSV)" when there is
  something to report and the shown diagnostics are the stored ones (not while updating). It is a
  `ButtonLink` to `api.catalogs.importIssues.url()`.

### 3. Mapping kept on diagnose

- **Server.** `diagnoseCatalogUpload` stores a valid mapping and its diagnostics on the upload
  (`columnMap`, `importMeta.diagnostics`), only while it is still `uploaded`. An invalid mapping
  changes nothing. `importMeta.edited` is set once the mapping differs from the stored one.
- **Preview.** `UploadPreview` has `edited` (contract default `false`).
- **Wizard.** It starts with `suggested = !edited`, so a mapping the user changed does not come
  back labelled "taklif" / "oldingi fayldan". The preset selector's "suggested mapping" option
  then also counts as the user's.

### 4. Same file again

- **Hash.** `catalog.fileHash` holds the SHA-256 of the uploaded bytes, set by
  `previewCatalogUpload`, with an index on `(orgId, fileHash)`.
- **Lookup.** `UploadPreview.sameFile` is the newest earlier committed catalogue (status not
  `uploaded`) with the same hash.
  - It looks only at the same client, which every catalogue has (the DB trigger fills the
    default client). With no client it would look across the org.
  - The lookup is scoped with `catalogScope`.
- **Wizard.** `file-check.tsx` shows a warning notice. It names the catalogue and its date, says
  the rows will count against the monthly limit again, and links to the earlier catalogue. It
  never blocks.

### 5. Streaming export

- **Writer.** `buildExport` now uses `ExcelJS.stream.xlsx.WorkbookWriter` (`useStyles`,
  `useSharedStrings`) and commits each row as it is added. Only the zipped bytes are collected.
  The columns' width and `numFmt '@'` and the frozen view are set before the first row, because
  the writer puts `<cols>` and the sheet views first. Its signature is unchanged.
- **Comparison test.** `export-stream.test.ts` keeps the old in-memory builder as the reference.
  It reads both files back and deep-compares:
  - creator and sheet name;
  - views (frozen `ySplit`);
  - each column's width, `numFmt` and style;
  - every cell's value, type and full style.

  Inputs:
  - the demo catalogue (`apps/web/public/demo/namuna-katalog.xlsx`), with code and unit columns
    both appended and overwritten in place;
  - the shapes the other export tests use: formula-like cells, ragged rows, Cyrillic, a Russian
    sheet name, no rows;
  - a generated 5,000-row, 8-column sheet.

  All are equal.
- **Byte-for-byte?** The content is identical. The zip bytes are not: the archiver compresses
  differently, and the 5,000-row file is 352 KB instead of 273 KB.
- **Peak RSS** (`process.resourceUsage().maxRSS`). Each run is a fresh `tsx` process, generating
  the rows and then building. The script is at
  `C:\Users\USER\AppData\Local\Temp\claude\C--Users-USER--claude-spares-spare-fVGCl0\3951f8b9-d9e8-4f30-a64b-1232877ddb6f\scratchpad\zz-s8-time-old.ts`
  (not committed).

  | Sheet | Before (in-memory) | After (streaming) |
  |---|---|---|
  | 0 rows (process baseline) | — | 100 MB |
  | 5,000 × 8, run 1 | 220 MB, 1.1 s | 136 MB, 0.9 s |
  | 5,000 × 8, run 2 | 221 MB, 1.0 s | 136 MB, 0.6 s |
  | 20,000 × 8 (one run) | 510 MB, 3.2 s | 225 MB, 3.1 s |

  - Above the baseline, the 5,000-row export goes from about 120 MB to about 36 MB.
  - Most of what remains is the input rows themselves and the shared-string table. The items and
    findings the export loads from the DB are unchanged; that load is outside `buildExport`.
  - No 60k run, per the rules.

### 6. `cellsPastColumnLimit`

- Added to the `ParseMeta` contract (optional, as the domain writes it).
- `file-check.tsx` shows a warning notice when the count is above zero, for example "500-ustundan
  oʻngdagi N ta toʻldirilgan katak oʻqilmadi…".
- `MAX_COLUMNS` is copied into `apps/web/src/lib/catalogs/upload.ts`, held equal to the domain by
  `tests/web-parity/catalogs.test.ts`.
- The CSV has a line for these cells too.

## Files changed

- **New:**
  - `packages/db/prisma/migrations/20261108000700_skipped_rows_file_hash/migration.sql`
  - `packages/domain/src/import-issues-csv.ts` and its test
  - `packages/domain/src/export-stream.test.ts`
- **Domain:**
  - `catalog-import.ts`: skipped-row handling, `skippedRows`, `allFileRows`, `fileHash` input
  - `catalog-upload.ts`: hash, diagnose persistence, commit `skipped`
  - `import-diagnostics.ts`
  - `export-rows.ts`
  - `catalog-exports.ts`: export rows, `catalogImportIssuesCsv`
  - `spreadsheet.ts`: `buildExport` only
  - `upload-preview.ts`: `edited`, `sameFile`, `sameFileAs`
  - `catalog-pages.ts`: `skippedRows` in the header, 1 line
  - `security/account.ts`: retention for skipped rows
- **Schema:** `schema.prisma` (`Catalog.fileHash`, `CatalogSkippedRow`).
- **Contracts:** `modules/catalogs.ts` (`ParseMeta`, `UploadPreview`, `commit`, `get`,
  `importIssues`), `README.md` checklist, `roundtrip.test.ts`.
- **API:** `catalogs/exports.controller.ts`.
- **Web:**
  - `upload/{file-check,diagnostics-panel}.tsx`
  - `upload/mapping-step.tsx`: one prop, and the preset line
  - `upload/upload-wizard.tsx`: two lines
  - `upload/wizard-start.test.ts`: fixture
  - `catalogs/[id]/workspace-header.tsx`: one item
  - `lib/catalogs/upload.ts`: `MAX_COLUMNS`
- **i18n:** `i18n-parts/imports.ts`, uz and ru:
  - `check.pastColumns`, `check.sameFile*`
  - `diag.download`
  - `confirm.dropped` (reworded)
  - `exp.notChecked`, `exp.skipped`
  - `issuesCsv`
- **Tests updated for the new shapes:**
  - `catalog-import.test.ts`
  - `usage-ledger.test.ts`: two `applyMapping` results
  - `catalog-exports.test.ts`, `catalog-upload.test.ts`, `security/account.test.ts`
  - `apps/api/test/e2e/catalogs.test.ts`, `catalogs-docs.test.ts` (41 operations)
  - `packages/api-client/src/client.test.ts`
  - `tests/web-parity/catalogs.test.ts`
- **Docs:** `docs/accounting-2026-10-23/migrations.md` and this report.
- **Outside the brief's list, kept minimal:**
  - `upload-preview.ts`, `catalog-pages.ts`, `security/account.ts`
  - `mapping-step.tsx`, `upload-wizard.tsx`, `workspace-header.tsx`
  - the test files listed above

  None of them belongs to S7, S9 or S10.

## How it was tested

**New tests:**

- **`import-issues-csv.test.ts`** (pure, 4 tests):
  - the walk matches the counts;
  - file line, data row, column, reason and cell in uz and ru;
  - a duplicate names the line it repeats;
  - codes stay text and formula cells are defused;
  - one line for rows past the limit and one for cells past the column limit;
  - a clean file gives only the header.
- **`export-stream.test.ts`** (3 tests): the streaming file equals the in-memory one on the demo
  file, the other tests' shapes and 5,000 rows.
- **`catalog-import.test.ts`:** a nameless row is not an item; it is in `catalog_skipped_row` with
  its cells; `allFileRows` is unchanged by the commit.
- **`catalog-exports.test.ts`:**
  - xlsx with every row in file order;
  - the nameless row unchanged, with the marker;
  - the failed row marked "texnik xato" and keeping its code;
  - the 1C CSV with all rows and the Russian markers;
  - the audit event counts;
  - the issues CSV the same before and after the commit, and 404 for another org or no id.
- **`catalog-upload.test.ts`:**
  - diagnose stores the mapping and diagnostics; `edited` is set; an invalid mapping changes
    nothing;
  - same-file: names the earlier committed catalogue with its date; null for an open preview,
    another client, or a file one line longer.
- **`security/account.test.ts`:** retention blanks a skipped row's unmapped cells.
- **`roundtrip.test.ts`:** `cellsPastColumnLimit`, `edited`, `sameFile`, commit `skipped`, and an
  older preview without the new fields.
- **API e2e `catalogs.test.ts`**, new case "S8: …", against the dev DB with an inline audit:
  - the same bytes as the first catalogue get `sameFile`;
  - a changed mapping comes back from `GET …/preview` with `edited: true`;
  - `GET …/import-issues` answers a CSV with the uz reasons;
  - the commit answers `{ ok, catalogId, skipped: 1 }`;
  - after the audit, the header has `skippedRows: 1` and the exported xlsx has every row in order,
    with the marker on the nameless one;
  - `import-issues` was added to the "another org's catalogue is 404" list.

**Full checks (worktree, 30 Oct):**

- `npm run typecheck`: exit 0.
- `npm run lint`: 0 errors. One warning predates S8: `scripts/lib/xlsx.ts:131`,
  no-non-null-assertion.
- `npm test`: 2,342 tests, 2,323 pass, 5 skipped, 14 fail.
  - **Skipped:** Redis not running (3), the weighted search column, the classifier vectors, and
    Didox live.
  - **Caused by S8, fixed in `43784a4`, both pass now:**
    - `packages/api-client/src/client.test.ts`: the commit answer now carries `skipped: 0`.
    - `apps/api/test/e2e/catalogs-docs.test.ts`: 41 operations instead of 40.
  - **Timeouts under load, passed when re-run one file at a time:**
    - `apps/api/test/e2e/catalogs.test.ts` (7 cases; first case "progress reaches ready", 187 s
      against its 180 s wait): 13/13.
    - `apps/api/test/e2e/didox.test.ts`: 7/7.
    - `apps/api/test/e2e/imports.test.ts`, "cheques … it finishes": 5/5.
    - `packages/domain/src/audit-jobs.test.ts`, 2 cases waiting for audits: 10/10.

    Three sibling sessions share the machine and Postgres 54329.
  - **Pre-existing, not caused by S8:** `packages/domain/src/didox/service.test.ts:141`, "an ended
    trial closes the upload…".
    - It expects "Срок подписки истёк." but gets the shared plan message.
    - `cf4c755` (my base) changed the message but not this test. `main` has since fixed it in
      `7979b3a` ("Didox sync answers the shared plan message too"), so it goes away when this
      branch is rebased or merged.
  - `packages/domain/src/plan-caps-race.test.ts` (the known flaky one) passed in this run.
- **Also run alone, all pass:**
  - `xlsx-stream`, `csv-safe`, `restricted-list`, `spreadsheet`, `export-data`, `usage-ledger`;
  - `import-diagnostics`, `catalog-import`, `catalog-upload`, `catalog-exports`,
    `security/account`;
  - `export-stream`, `import-issues-csv`;
  - all contracts tests, `http-wiring`, `tests/web-parity/catalogs`, `wizard-start`.

## What remains or is unverified

- **No browser check of the wizard UI.** That covers the same-file notice, the column-limit
  notice, the CSV button, the edited mapping coming back, and the workspace header item. The
  seeded `buxgalter@demo.uz` org is a demo org, and demo orgs cannot upload, so a manual check
  would need a fresh test account. The server side of all of these is covered by the domain and
  e2e tests, and the components pass typecheck and lint.
- **Catalogues committed before this change** have no `catalog_skipped_row` rows. Their exports
  still lack the nameless rows; the header count (from `importMeta`) still shows them.
- **Only the web wizard computes `fileHash`.** Telegram and public-API uploads have none, so a
  file uploaded through the bot and then through the web is not recognised.
- **Diagnose race.** Two overlapping diagnose calls could store the earlier mapping last. The
  wizard debounces at 350 ms and the commit always uses the mapping it sends, so the window is
  only the resume screen.
- **The streamed xlsx is about 30 % larger on disk** (different deflate in archiver). The content
  is equal. Passing `zip: { zlib: { level: 9 } }` to the writer would shrink it at some CPU cost;
  not done, not measured.
- **The export still loads every item and finding into memory before writing**
  (`exportItems`). Only the workbook model is gone. Paging the DB read is the next step if a
  60k export's memory matters.
- **The 60k memory check is for the overnight run (S11).**

## Open questions for the owner

1. **1C files and nameless rows.** They now carry the nameless rows, with an empty name and the
   "not checked" status, as the brief asked ("every input row"). A 1C load from a spreadsheet may
   create an empty item from such a row. Keep them in the 1C files, or only in the corrected
   Excel?
2. **Code on a failed row.** A row whose check failed keeps the code a person accepted on it, for
   example from a purchase finding, while its status says "not checked". Should it always keep
   the file's own code instead?
3. **Which catalogue the warning names.** The same-file warning names only the newest earlier
   catalogue of the same client. Should it also look across the org when the same file was
   uploaded for another client? That is not done now, to avoid naming another client's catalogue
   to a scoped accountant.
