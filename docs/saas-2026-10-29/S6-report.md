# S6 — Input and DoS limits: report

Branch `feat/s6-input-limits` (cut from `feat/saas-hardening-plan` at `4288271`), worktree
`.claude/worktrees/agent-af83a5fa7f8ee4233`. Findings F13 and three F20 items (module-flag case,
1C DNS pinning, public bodies). Not pushed, not merged.

## What was done

### F13: the spreadsheet parser (packages/domain)

- **New `xlsx-stream.ts`.** It parses the first worksheet row by row instead of using
  `workbook.xlsx.load`. The archive is opened from the buffer with yauzl. Then:
  - the workbook, rels, styles and shared strings are parsed with ExcelJS's own parsers, the same
    ones `load()` used;
  - the sheet XML is streamed through ExcelJS's SAX helper;
  - each `<row>` is decoded by ExcelJS's `RowXform`/`CellXform` and reconciled with the same
    options `load()` passed.

  This is why values come out as before: dates, the 1904 calendar, cached formula results of every
  type, shared formulas, rich, shared and inline strings, `_x000D_`. The merge refs are read in a
  first, regex-only pass over the sheet text, because they come after the rows. Each row then has
  its merged cells removed the way `load()` did, so only the top-left cell keeps a value.
- **The brief asked for ExcelJS's public `WorkbookReader`; I did not use it** (the code says why).
  Reading its source (exceljs 4.4.0) showed four problems:
  - It decodes each chunk with `TextDecoder.decode(chunk)` without carrying a split character over,
    so Cyrillic is corrupted at 16 KB chunk edges.
  - It ignores `<mergeCells>`.
  - It reads a formula's boolean or error result as `parseFloat` (`1` or `NaN` instead of
    `true` or empty).
  - When the shared strings come after the sheets, it writes every sheet to a temp file. Excel and
    ExcelJS both write them in that order.

  Each of these would have broken the "identical output" requirement on real files.
- **`spreadsheet.ts`, `readXlsx`:**
  - Uses the streaming reader. Rows past `MAX_ROWS + 20` are counted, not kept.
  - **Deviation from the brief ("stop reading after MAX_ROWS + 1"):** the truncation notices quote
    the file's total, for example `jami N`, `В файле N строк` and the bank notice. Stopping early
    would put a wrong number on screen, so counting continues. Memory stays bounded and the time is
    bounded by the inflate cap. CSV is unchanged. `buildExport` is untouched.
  - New `cellText` export, for the equality test.
- **Column cap.** `MAX_COLUMNS = 500` (`sheet-shape.ts`). Cells to the right of the cap are not read.
  Cells that hold a value there are counted into `ParseMeta.cellsPastColumnLimit`. That field is a
  diagnostic, not an error, and is absent when the count is 0. The mapped-column logic is unchanged.
  A row of more than 16,384 cells (Excel's own maximum) is unreadable.
- **Inflate cap (deviation, measured).**
  - The new `XLSX_HELD_BYTES = 30 MB` applies to the parts kept in memory while the sheet streams:
    the workbook, rels, styles and shared strings. Over it, the answer is `zip_limits`.
  - The whole-archive cap stays at 100 MB. Measured reason: the worksheet XML of one generated
    60,000 × 20 file inflates to 43 MB on its own, plus 9.6 MB of shared strings, 53 MB in total.
    A 30 MB whole-archive cap would refuse files the product promises to read.
  - The sheet now streams, so its size costs time, not memory. To apply the literal 30 MB cap
    instead, change `ZIP_LIMITS.maxTotalBytes`.
- **Peak memory, measured once each on the same generated 60,000 × 20 file (8.3 MB, 1.2 M cells),
  in a fresh process, `parseUpload`:**

  | Reader | Peak RSS | Time |
  |---|---|---|
  | Before (`workbook.xlsx.load`) | **897 MB** | 21.2 s |
  | After (streaming) | **463 MB** | 28.3 s |

  - Both times were taken while five sibling agents were running tests on the same machine, so the
    times are noisy.
  - On a 20,000-row slice, timed back to back in fresh processes, the new reader was faster:
    old 2.8–3.9 s and 406–557 MB, new 1.7–3.4 s and 282–289 MB.
  - Most of the remaining 463 MB is the result itself (1.2 M cell strings) and `shapeGrid`'s row
    copies, which have not changed.

### F13: per-org upload concurrency (apps/api)

- **New `http/upload-slots.ts`.** At most 2 spreadsheet uploads per org and 8 per process are read
  and parsed at once. The key is the session org or the API-key org; the anonymous lead form uses
  the client address.
- **Excess uploads** get **429 `rate_limited` with `Retry-After: 5`**, in the existing error shape:
  - `{ error: { code, message } }` in the reader's language, from the new key `httpX.uploadBusy`
    (uz and ru);
  - the documented v1 envelope on `/api/v1`.
- **Where the slot is taken and given back:**
  - `MultipartInterceptor` takes it before multer reads the body and gives it back when the handler
    finishes (rxjs `finalize`). That covers catalogue, bank, Didox, purchases and docs, products and
    1C counterparty uploads.
  - The `/api/v1` upload and the lead form take it around their own reads.
- **A refused body is read to its end and dropped** before answering (`discardBody`, bounded at
  32 MB). Without that, a large upload got `ECONNRESET` instead of the answer. A test covers this.

### F20: request bodies (apps/api/src/http/request-body.ts)

- **Byte counting.** `readBody` counts bytes as they arrive and refuses past a cap given by the
  caller. It also refuses a declared `Content-Length` over the cap. The answer is **413
  `too_large`**: `httpX.tooLarge` in the reader's language on first-party routes, the v1 envelope
  on `/api/v1`. Nothing past the cap is kept. Stream errors other than the cap still read as
  "not JSON" or "not a form", as before.
- **Caps:**

  | Route | Cap |
  |---|---|
  | Default | 1 MB (same as the global parsers) |
  | Lead form | 5 MB file + 128 KB for the form around it |
  | `/api/v1` upload | 20 MB + 128 KB |
  | Click and Payme callbacks | 64 KB |

  The 128 KB allowance keeps a file of exactly 5 MB (or 20 MB) answered by the domain's own
  "too big" message, as before.
- **Lead order.** `leadRateRefusal` was split out of `submitLeadForm` (`lead-submit.ts`). The
  controller spends the address limit **before** the body is read; a refused sender's body is
  dropped unread. Side effect: a submission with the honeypot filled now also uses up one of the
  five allowed per address.

### F20: module-flag guard (packages/contracts/src/feature-modules.ts)

- `modulesOfApi` lowercases the path, so `/api/BANK/...` gets the bank module's flag.
- A test checks that every API prefix is lowercase.
- `apps/web/src/middleware.ts` was not changed. It uses `modulesOfRoute` and `underPrefix`, not
  `modulesOfApi`, and Next.js page routes are case-sensitive, so a mixed-case page URL is a 404
  anyway and there is no bypass there.

### F20: 1C host check (packages/domain/src/onec)

- **New `host-guard.ts`.**
  - `hostFetcher` resolves the host once.
  - In production it refuses the host when any answer is reserved, unless
    `ONEC_ALLOW_PRIVATE_HOSTS=1`.
  - Otherwise it returns a fetch over `node:http`/`node:https` whose `lookup` hands back the
    **already-checked address**. The name is never resolved again, and the Host header and TLS
    name stay the configured host.

  Node's built-in `undici` `Agent` is not importable without adding the `undici` package. That
  would have meant lockfile churn while five sibling branches were open, so the `lookup` option of
  `node:http` does the same pinning.
- **Reserved ranges** are now a `net.BlockList`:
  - IPv4: the old ranges plus **192.0.0/24, 198.18/15, 224/4, 240/4** and the documentation ranges;
  - IPv6: `::`, `::1`, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32, the NAT64 prefixes;
  - IPv4-mapped IPv6 in any spelling. The old prefix check missed `::ffff:7f00:1`, which is how
    the URL parser writes `[::ffff:127.0.0.1]`.
- **Callers.** `testConnection` and `transferExport` (`transfer.ts`, a few lines) use the pinned
  fetch. `connection.ts` re-exports `hostAllowed`, `hostFetcher` and `privateAddress`.

## Files changed

- **New:**
  - `packages/domain/src/xlsx-stream.ts` and `xlsx-stream.test.ts`
  - `packages/domain/src/onec/host-guard.ts` and `onec/connection.test.ts`
  - `apps/api/src/http/upload-slots.ts`
  - `apps/api/test/unit/input-limits.test.ts`
  - `apps/api/test/e2e/input-limits.test.ts`
- **Changed, in owned files:**
  - `packages/domain/src/spreadsheet.ts` (parse side only), `sheet-shape.ts`, `security/zip-guard.ts`
  - `apps/api/src/http/request-body.ts`, `http/multipart.ts`
  - `apps/api/src/demo/demo.controller.ts`
  - `apps/api/src/billing/payments.controller.ts` (cap arguments only)
  - `apps/api/src/public-api/public-api.controller.ts`
  - `packages/contracts/src/feature-modules.ts` and its test
  - `packages/domain/src/onec/connection.ts`
  - `apps/api/test/unit/module-guard.test.ts`
- **Changed outside the listed files** (no wave-1 owner, kept minimal):
  - `packages/domain/src/lead-submit.ts`: `leadRateRefusal` split out, `rateChecked` option.
  - `packages/domain/src/onec/transfer.ts`: uses the pinned fetch.
  - `packages/i18n/src/i18n-parts/http.ts`: `uploadBusy`, uz and ru. i18n parts are a known merge
    point; S6 only adds one key.
  - `public-api.controller.ts` gets the upload slot, beyond the "cap argument only" in the brief.
    The v1 upload parses a 20 MB spreadsheet in the request, so leaving it out would have left a
    hole in F13.

## How it was tested

- **`packages/domain/src/xlsx-stream.test.ts`** (9 tests). The old `load()` reader is kept in the
  test as the reference, and the grids must match row by row, together with the parsed upload, on:
  - `apps/web/public/demo/namuna-katalog.xlsx`;
  - the 3 bank fixtures and the 2 committed docs workbooks;
  - the 1C golden outputs (`nomenclature_xlsx`, `receipt_xlsx`, `counterparties_xlsx`, built as
    `formats.test.ts` builds them), `build1cXlsx` and `buildExport`;
  - a workbook the upload tests write with ExcelJS;
  - a hand-written workbook (with and without `date1904`): merged cells with values in the hidden
    cells, a row of merged cells only, date and custom date formats, percent and text formats,
    error cells, cached formula results (number, string, boolean, error, date), shared formulas,
    rich shared and inline strings, `_x000D_`, a cell without an address, sheets listed out of file
    order with an absolute rel target, and 900 Cyrillic rows across chunk edges.

  It also checks values outright, so the equality is not vacuous. Limits covered: the column cap
  and its count, the held-parts cap (direct and through `parseUpload`, answering `zip_limits`),
  `no_sheet` and `unreadable` (a cut-off sheet), and a 60,025-row file that keeps 60,000 and reports
  a total of 60,025.
- **`packages/domain/src/onec/connection.test.ts`** (7 tests):
  - reserved and public address tables;
  - `hostFetcher` with a stubbed resolver: development passes through; production refuses a
    private answer, a mix, no answer, a failed lookup and private literals, and resolves a public
    name only once;
  - pinning end to end: a local server reached as `onec.rebind.test`, a name that resolves
    nowhere, with the stub answering 127.0.0.1 first and 203.0.113.1 after. GET and POST both
    reach the server, the resolver is called once and the Host header is the configured name;
  - fetch-like failures: `ECONNREFUSED` in `cause`, and a timeout.
- **`apps/api/test/unit/input-limits.test.ts`** (7 tests): capped readers (within the cap, growing
  past it, a declared length over it, the v1 message, multipart into FormData) and the slot
  counting and 429.
- **`apps/api/test/e2e/input-limits.test.ts`** (7 tests, dev DB):
  - lead 413 in Uzbek;
  - lead limit before body: the sixth request with an oversized body gets the rate-limit message,
    not a 413;
  - `/api/v1` 413 in the v1 envelope;
  - Payme with a non-JSON body over 64 KB answers 413, and a small one still gets the JSON-RPC
    answer;
  - per-org slots: 429 with `Retry-After` on both `/api/catalogs/preview` and `/api/v1`, then 200
    once a slot is free, with the slot given back;
  - the process-wide cap of 8, where a refused 3 MB upload still receives its 429;
  - the same module answer for `/api/didox/invoices` and `/API/DIDOX/invoices`.
- **Module guard:** mixed-case cases in `feature-modules.test.ts` and
  `apps/api/test/unit/module-guard.test.ts`.
- **Re-run, all green:** `onec/export.test.ts`, `apps/api/test/e2e/onec.test.ts`,
  `apps/api/test/e2e/demo.test.ts`, `spreadsheet.test.ts`, `zip-guard.test.ts`, the bank tests and
  `formats.test.ts`.
- `npm run build:api` bundles. The deep `exceljs/lib/...` modules resolve from
  `apps/api/dist/main.mjs` through `createRequire`.
- **Full run:** see "Full checks" below.

## What remains or is unverified

- **`cellsPastColumnLimit` is not shown in the upload wizard.** The field is stored in the
  upload's parse meta, but the response schema `ParseMeta` lives in
  `packages/contracts/src/modules/catalogs.ts`, which S2 owns. Adding the field there and a notice
  in `(app)/upload/file-check.tsx` fits S8 (import diagnostics, wave 2).
- **Click callbacks keep their `.catch(() => null)`** (S5's line). A non-form Click body over
  64 KB therefore answers Click's own "request" error rather than 413. Memory is bounded either way.
- **Payment callbacks with the normal content types** (urlencoded for Click, JSON for Payme) are
  read by the global body parsers, whose limit is 1 MB. Per-route parser limits would mean changing
  `app.ts`, which is outside S6.
- **Upload slots are per process,** not cluster-wide. A client that sends its body very slowly
  holds its slot until Node's request timeout.
- **Unchanged ExcelJS quirks.** The old reader turned a hyperlink cell holding a number into an
  empty string; the new reader returns the number. A first cell without an address, a row without
  `r`, and overlapping merges made the old reader fail; the new reader reads them, refusing
  overlapping merges only past 500 per row. Neither case is in any committed file.
- **No real 1C test.** No real 1C or production DNS was used; pinning is proven with a local server
  and a stubbed resolver. With `ONEC_ALLOW_PRIVATE_HOSTS=1`, a name that does not resolve now
  answers `host_refused` instead of `unreachable`.

## Open questions for the owner

1. **Inflate cap:** keep 100 MB for the whole archive and 30 MB for the parts held in memory (what
   was built), or take the literal 30 MB total, which refuses large 60,000-row files?
2. **Lead honeypot:** a filled honeypot now uses up one of the five submissions per address,
   because the limit runs before the body is read. Acceptable?

## Full checks (worktree, 30 Oct)

- `npm run typecheck`: **passes** (exit 0).
- `npm run lint`: **0 errors**. One warning predates S6: `scripts/lib/xlsx.ts:131`,
  `@typescript-eslint/no-non-null-assertion`.
- `npm test` (`node scripts/test.mjs`, 1,702 tests): the first run had 1,604 pass and 89 fail.
  Every failure was environmental. The shared dev Postgres on 54329 went into **recovery mode**
  mid-run, with five sibling agents testing against it. The log shows "FATAL: the database system
  is in recovery mode" 51 times, plus "Connection terminated unexpectedly", 500s and audit
  timeouts. Docker was not touched.
- Once the DB was back, the 25 failing files were re-run together: 2,060 passed and 16 failed. The
  16 were "Can't reach database server" and audits timing out under load.
- Those 8 files (`catalogs`, `account`, `auth`, `billing`, `clients`, `imports` e2e, `audit-jobs`,
  `audit-retry-access`) were then re-run one at a time: **70/70 pass**.
- No failure traced to S6. Every S6 test file passed in the full run and in the re-runs.
