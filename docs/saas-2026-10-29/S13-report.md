# S13: bulk-bar disputes, batched export, pre-S8 nameless rows (report)

Branch `feat/s13-dictionary-export`, cut from `main` at `db755db`, worktree
`.claude/worktrees/agent-addb3a12436397aff`. Closes three gaps from `FINAL_REPORT.md` §5 item 6:
the bulk bar's reject (S4), the export's memory (S8), and catalogues committed before S8. Not pushed,
not merged.

## Checked in the code first (30 Oct)

- **Bulk reject.** As the brief said. `decide-many.ts` already took `disputes` (line 34) and
  passed the map to `disputeEntries` (line 112). `bulk.ts` `bulkApply`, the only bulk-bar caller,
  never built it. The group path (`recordGroupDecision`) builds it with `dictionaryEntriesOf`.
- **"Wrong suggestion".** `suggestion-feedback.ts` already disputes, through `dictionaryEntriesOf`
  and `disputeEntries`, and S4's test covers it. Nothing was changed there.
- **Export.** `catalogExport` called `exportLines`, which loaded every item with its findings, and
  every skipped row, in two queries. It then built every `ExportRow` (and every `OneCRow` for 1C)
  in arrays. The 1C .xlsx used the in-memory ExcelJS workbook. The 1C CSV joined every line at the
  end.
- **Brief vs code: the order.** The brief suggests `orderBy: { id: 'asc' }` with a cursor. Item ids
  are cuids, not file order, and the output must stay in file order. `(catalogId, rowIndex)` is
  unique in both `catalog_item` and `catalog_skipped_row`. So the pages are keyset pages on
  `rowIndex` (`rowIndex > last ORDER BY rowIndex LIMIT n`), which use that unique index.
- **No file copy.** `schema.prisma` keeps no copy of an uploaded catalogue: `Catalog.fileHash` (a
  SHA-256) only. The `Bytes` columns are the org logo, the landing-page `Lead.fileData`, the 1C
  export file, and PDFs. So pre-S8 nameless rows cannot be backfilled. No file store was built.
- **The header.** It never showed "0 qator nomsiz": `workspace-header.tsx` renders the line only
  when the count is above zero. The real problem was the other way round. `catalogHeader` took the
  count from the import diagnostics (`importMeta.diagnostics.noName.count`), so a pre-S8 catalogue
  said "N qator nomsiz: tekshirilmadi, eksportda belgilangan" ("N nameless rows: not checked,
  marked in the export"). Its export does not have those rows.
  - Dev DB (30 Oct): 177 committed catalogues. 19 have a nameless count above 0, and **all 19**
    have no `catalog_skipped_row` rows, so all 19 made that false claim. 11 have a count of 0. 147
    have no diagnostics.

## What changed

### 1. A reject from the bulk bar disputes dictionary entries

- `packages/domain/src/bulk.ts`: for `kind: 'reject'`, `bulkApply` calls
  `dictionaryEntriesOf(actor.orgId, rows)` on the pending rows it loaded, and passes the map to
  `decideMany` as `disputes`.
- The rules are the single and group paths' rules, because it is the same function:
  - only findings whose evidence stage is `dictionary`;
  - only while the entry still holds the suggested code;
  - only entries of the caller's org (`where: { orgId }`).
- `decideMany` already keeps only the rows the UPDATE changed. It writes `dictionary.disputed`
  events and `dictionaryDisputed` on the `finding.bulk_rejected` event, and its undo lifts the
  dispute.

### 2. The export reads in batches

- **`export-rows.ts`**
  - `EXPORT_BATCH = 2_000`.
  - `exportLineBatches(catalogId, { batchSize })`, an async generator, reads the rows in keyset
    pages of `batchSize`: items with their findings, and skipped rows.
  - It merges the two with `inFileOrder`'s tie rule (a skipped row goes first only when its
    `rowIndex` is smaller) and yields `ExportLine[]` of `batchSize` lines.
  - `exportItems` and `exportLines` are unchanged in behaviour. They share the select and mapper
    with the pages. `exportItems` is still used by `products/catalog.ts`; `exportLines` is now the
    test's reference.
- **`catalog-import.ts`**: `skippedRows(catalogId, page?)` takes an optional `{ after, take }`.
- **`catalog-exports.ts`**
  - `exportFileRows(catalogId, mapping, locale, tally, { batchSize })` is an async generator of
    `{ line, row }`. Per batch it looks up only that batch's code units and restrictions. It
    counts the `catalog.exported` numbers into `tally` as rows go by: rows, distinct accepted
    codes, partial, pending, skipped and failed.
  - `catalogExport` feeds that generator straight into the writers: `buildExport` for the
    corrected file, `build1cXlsx` for the 1C .xlsx, `stream1cCsv` for the 1C CSV.
  - Status, codes, units and markers are built exactly as before (the same lines moved into the
    loop). The audit payload has the same fields and values.
- **Writers**
  - `spreadsheet.ts` `buildExport` takes `rows: ExportRows` (a list or an async iterable).
    `ExportOptions` itself is unchanged, so `export-stream.test.ts`'s reference builder compiles
    as it was. The stream plumbing moved into the new `xlsx-writer.ts` (`streamedXlsx`); the
    sheet code is unchanged.
  - `onec/sheets.ts` `build1cXlsx` now streams through `streamedXlsx` and takes a list or an async
    iterable. Columns are set before the first row, and the frozen view is passed at
    `addWorksheet` (the streaming writer's order). The other callers pass lists, as before.
  - New `stream1cCsv(rows, headers)` writes `build1cCsv`'s exact bytes from an async source. Only
    the text parts are kept.
  - `export-1c.ts` re-exports `stream1cCsv`.
- **Not batched: the CSVs with their own loaders.**
  - The import-issues CSV (`allFileRows`) needs every row for duplicate detection.
  - The report CSV and PDF (`reportPdfData`) read findings, not the export rows.
  - The diff CSV (`versionDiff`).

  None of them shares the export loader. They are unchanged.

### 3. Pre-S8 catalogues: no claim the export does not keep

- `catalog-pages.ts` `catalogHeader`: `skippedRows` is now
  `count(catalog_skipped_row WHERE catalogId)`, which is what the export writes, and still 0 while
  the catalogue is `uploaded`.
- A pre-S8 catalogue gets 0, and the header renders nothing.
- A post-S8 catalogue is unchanged: the commit writes one skipped row per nameless row in the same
  transaction, and the e2e check of `skippedRows: 1` still holds.
- The diagnostics' nameless count is still shown where it was before: the upload's done step, the
  diagnostics panel and the PDF.
- Contract `catalogs.get.skippedRows`: only its doc comment changed. The shape is the same, so the
  registry, checklist and counts did not change.

## Files

- **Domain:**
  - `bulk.ts`
  - `export-rows.ts`, `catalog-exports.ts`, `catalog-import.ts` (`skippedRows` paging)
  - `spreadsheet.ts` (`buildExport` only)
  - `xlsx-writer.ts` (new)
  - `onec/sheets.ts` (`build1cXlsx`, `stream1cCsv`), `export-1c.ts` (re-export)
  - `catalog-pages.ts`
- **Tests:**
  - `dictionary-safety.test.ts` (new case)
  - `export-batches.test.ts` (new)
  - `export-stream.test.ts` (3 new cases; the existing ones are untouched)
  - `catalog-pages.test.ts` (new case)
- **Contracts:** `modules/catalogs.ts`, one comment.
- **Docs:** this report.

## Tests added

- **`dictionary-safety.test.ts`**, case "a reject from the bulk bar disputes only the own org's
  entries…". `bulkApply(accountant, catalogue, { ids }, { kind: 'reject' })` over four rows:
  - two dictionary rows of one entry;
  - one row with a plain (non-dictionary) suggestion whose name has its own entry;
  - one row whose evidence names another org's entry.

  It checks:
  - `count === 4`;
  - only the own entry is disputed (by the accountant), with exactly one `dictionary.disputed`
    event;
  - the `finding.bulk_rejected` event has `dictionaryDisputed: [entry]`;
  - auto-accept (`acceptDictionaryMatches … 'auto'`) accepts 0 rows of a later catalogue with that
    entry;
  - `undoDecision` lifts the dispute, after which auto-accept accepts 1.

  The case was confirmed to fail with the `bulk.ts` change removed (`AssertionError: disputed`).
- **`export-batches.test.ts`** (DB). A 4,500-row catalogue:
  - nameless rows at row 0, at the last row, as a run 995–1005 across the first batch edge, and
    every 37th;
  - accepted, pending, rejected and no-finding rows in turn;
  - failed checks every 101st row.

  It checks:
  - read 1,000 at a time it gives batches `[1000, 1000, 1000, 1000, 500]`, and lines deep-equal to
    one 10,000 batch and to `exportLines`, rowIndex 0…4499 in order;
  - the written rows and the tally from `exportFileRows` are deep-equal between batch 1,000 and
    10,000.
- **`export-stream.test.ts`**, new cases:
  - `buildExport` fed row by row equals the in-memory reference (2,500 rows);
  - the streamed 1C .xlsx equals the pre-S13 in-memory `build1cXlsx` (copied into the test) for 0,
    3 and 3,000 rows, from a list and fed, and with the default headers;
  - `stream1cCsv` is byte-identical to `build1cCsv` (0 and 3,000 rows, given and default
    headers).
- **`catalog-pages.test.ts`**: a catalogue with `importMeta.diagnostics.noName.count = 2` and no
  kept rows gets `skippedRows 0`; after two `catalog_skipped_row` rows, 2.

## 20k-row measurement (once)

**Setup**

- Script: `tmp/s13-export-bench.ts`. `tmp/` is gitignored, and the script is not committed.
- The data was seeded once into a test org (dropped afterwards):
  - 20,000 file rows of 8 columns;
  - 400 nameless rows kept as `catalog_skipped_row`;
  - 19,600 items, each with one MISSING finding (a third of them accepted), plus a unit finding on
    every 4th item.
- Each figure is one `catalogExport` call in a fresh `tsx` process.
- The peak is `process.resourceUsage().maxRSS`. "Base" is the RSS just before the call, after the
  imports and a DB round trip.
- "Before" is the same worktree with the six pre-S13 files checked out from `db755db`. They were
  restored right after.
- The machine and Postgres were shared with three sibling agents, so the wall times are noisy.

| Format | Before: peak RSS (base) | After: peak RSS (base) | Above base, before → after | Wall, before → after | Bytes, before → after |
|---|---|---|---|---|---|
| Corrected .xlsx | 405 MB (172) | 366 MB (155) | 233 → 211 MB | 8.7 → 11.7 s | 1,508,680 → 1,508,679 |
| 1C .xlsx | 470 MB (156) | 319 MB (156) | 314 → 163 MB | 5.1 → 7.9 s | 691,207 → 854,315 |
| 1C CSV | 310 MB (156) | 265 MB (156) | 154 → 109 MB | 3.0 → 4.7 s | 1,727,582 → 1,727,582 |

### What the numbers say

**Memory.**

- The 1C .xlsx gains most (−151 MB above base), because the in-memory workbook is gone.
- The corrected .xlsx gains little (−22 MB). At 20k rows the DB load was never the large part;
  the streaming writer is.
  - The writer keeps the shared-strings table (`useSharedStrings: true`, S8's choice for
    identical content). That table grows with the distinct cells.
  - `maxRSS` also counts garbage V8 has not collected yet.

**What is bounded now.** A live-heap check on a 5,000-row catalogue (not 20k), with a forced GC
every 1,000 rows (`tmp/s13-heap.ts`):

- while the rows stream, the live heap stays at **+1 MB** at every sample: `[1, 1, 1, 1, 1]`;
- holding all 5,000 lines as before is **+8 MB**, so about 32 MB at 20k and about 96 MB at 60k.

The loader is bounded by a batch. What still grows with the catalogue:

- the xlsx writer's shared strings;
- the output bytes;
- the distinct accepted codes in the tally.

**Wall time.** It is worse in all three single 20k runs, by 3.0, 2.8 and 1.7 s. I cannot attribute
that to the change:

- Three 5k runs each of the corrected .xlsx: before 4.2 / 4.1 / 4.05 s, after 4.5 / 6.95 / 3.5 s.
- An alternating read-only A/B on 5k rows, three rounds (`tmp/s13-read-ab.ts`):
  - unbatched `exportLines`: 785 / 894 / 989 ms;
  - 2,000-row batches: 883 / 852 / 1188 ms.

The two overlap. The extra cost of paging is 2 queries per 2,000 rows. A clean 20k timing would
need an idle machine (overnight), and by the rules the 20k run was done once.

**File size.**

- The streamed 1C .xlsx is 24% larger on disk (archiver's deflate). The content is equal, as
  tested. This is the same effect S8 saw for the corrected file.
- The CSV is byte-identical. The corrected file is one byte apart (both were already streamed by
  S8, so this is the zip container). The 20k files' content was not compared cell by cell; the
  equality tests above cover the content.

## Tests run (real results)

**Commands.** All from the worktree root, with `DATABASE_URL` on `127.0.0.1:54329`,
`connection_limit=4`.

- `npm run typecheck`: exit 0 (every workspace and the root).
- `npm run lint`: exit 0. 0 errors, 1 warning that predates this branch
  (`scripts/lib/xlsx.ts:131`, no-non-null-assertion).
- Domain, one run of 20 files (`node node_modules/tsx/dist/cli.mjs --test …`): **142 tests, 142
  pass**, 0 fail, 0 skipped.
  - Export: `export-batches`, `export-stream`, `export-effective`, `export-data`,
    `export-filename`, `catalog-exports`, `catalog-import`, `catalog-pages`.
  - Spreadsheet and 1C: `csv-safe`, `restricted-list`, `spreadsheet`, `xlsx-stream`,
    `onec/formats`, `onec/export`.
  - Others: `security/account`.
  - Decisions and dictionary: `bulk`, `decisions`, `dictionary`, `dictionary-review`,
    `dictionary-safety`.
- API e2e, one run: `apps/api/test/e2e/dictionary.test.ts`, `workspace.test.ts` (bulk and
  decisions through the API) and `catalogs.test.ts` (the exports through the API).
  - **Together** (one process, three files): 35 tests, 16 pass, 5 fail, 14 cancelled. The cause
    was the database, not the code: "Can't reach database server at `127.0.0.1:54329`" in a
    fixture, the API answering 500 `server_error`, and "timed out waiting for the audit" (389 s).
    Sibling agents were running tests on the same Postgres at the time.
  - **Right after, each file alone:** `dictionary.test.ts` 8/8, `workspace.test.ts` 14/14,
    `catalogs.test.ts` 13/13. The last includes S8's "every row in order with the marker" export
    case and `skippedRows: 1` in the header.

**During development, each alone.**

- `dictionary-safety`: 8/8.
- The nine existing export test files: 79/79, before the new tests were added.
- `export-stream` and `export-batches`: 8/8.
- `catalog-pages`: 7/7.

## What I could not do, and why

- **No browser check of the header.** The change is server-side, and the component already hides
  a zero.
- **No backfill of pre-S8 nameless rows.** The uploaded files were never stored (only their hash).
- **Single 20k run.** The memory and wall-time numbers come from one run per format on a shared
  machine, as the rules ask. The wall-time difference is not explained.
- **The streaming .xlsx writers still hold the shared-strings table.**
  - Turning it off (`useSharedStrings: false`, inline strings) would cut the memory further.
  - It would change the cell storage the S8 equality test compares, so I left it.
- **The 1C .xlsx moved to the streaming writer.** That is the only change to a 1C builder.
  - The other 1C files (`nomenclature_xlsx`, `receipt_xlsx`, `counterparties_xlsx`, bank) still
    use the in-memory workbook with fixed dates for golden bytes.
  - Untouched: their golden tests pass.

## Open questions for the owner

1. **Pre-S8 catalogues.** Should the header say something else, for example "N qator nomsiz:
   tekshirilmadi (bu eksportda yoʻq)", instead of nothing? That needs a contract field and i18n.
   Today the count is still in the diagnostics and the PDF. Re-uploading the file fixes the export.
2. **Shared strings.** Turn them off in the streaming writers to cap the corrected .xlsx's memory
   further, at the cost of larger files? It needs its own measurement on an idle machine.
3. **Batch size.** It is 2,000 as briefed. With nothing else running, a 5,000 batch would halve
   the round trips; the 5k A/B could not tell them apart.
