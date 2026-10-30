# Documents modules: independent review of the merged work (30 Oct 2026)

Scope: `git diff 1afccd1..65bbe01`, the four "documents" modules merged on 30 Oct (S1 bank, S2 Didox, S3 products,
S4 1C/OData; plan and results in `DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md`). I reviewed the code, not the plan's claims.
Four reviewers (one per module) read the diff in parallel and reproduced what they could with scratch scripts. I then
checked every finding below against the code before listing it, and fixed the critical and major ones that a small
change settles.

Branch `claude/docs-review-2026-10-30-e2be64`, on top of 65bbe01, not pushed. Scratch DB `mxik_rev` (68 migrations,
plus the classifier tables copied read-only from `mxik` without embeddings). **Drop it when done:** `DROP DATABASE mxik_rev`.

## Summary

| Severity | Found | Fixed here | Left open |
|---|---:|---:|---:|
| Critical | 7 | 7 | 0 |
| Major | 22 | 15 | 7 |
| Minor | 29 | 1 (with a major's fix) | 28 |

The B5 approval gate itself holds: every export path (the `/api/onec` prepare, export and transfer endpoints, the bank,
Didox and products callers, `buildFile`, the OData transfer) goes through `planFor` → `planExport` → `approved()`. Two
ways a record nobody should book still left Tasnivo were in the Didox *document* status, not the line decision
(R-D2, R-D3). Both are fixed.

## Fixes made (each with a regression test that fails without the fix)

| ID | Severity | Commit | What | Test |
|---|---|---|---|---|
| R-B1 | critical | 06089ac | `.xls`: a 1 KB file claiming 1 000 000 FAT sectors (DIFAT pointing at itself) grew the FAT array until V8 aborted the whole API process (an uncatchable "invalid size error"). The FAT may not have more sectors than the file. | `bank/xls.test.ts` |
| R-B2 | critical | 3d31ed0 | Bank zip upload: the one file inside was unzipped against the 100 MB budget of a streamed `.xlsx`, so a 97 KB zip of 95 MB of text ran the reader out of memory. It may now inflate to the 20 MB upload limit. | `bank/real-layouts.test.ts` "a zip whose one file inflates past the upload limit" |
| R-B3 | critical | 28b275e | HTML/XML "xls" statements: `<[^>]*>`, `<tr\b[^>]*>`, the comment/script and unclosed `<Row>`/`<Cell>` patterns rescanned to the end of the text from every start. 400 KB of `<` blocked the event loop for 62 s (hours at 20 MB). The reader is now linear (≤ 40 ms for the same inputs; a real 5.4 MB table 233 ms). | `bank/markup.test.ts` |
| R-P1 | critical | d6d227a | Products, "empty cells clear" on: a damaged ИКПУ (leading zero lost), an unreadable price ("договорная") or VAT cell ("12% НДС") leaves the record's value null, and that null wiped the saved code, price and VAT. An Excel column of codes stripped of their zeros would wipe every saved code. The clear set is now per record, without the fields whose cell held something. | `products/import-real.test.ts` "opted-in clearing empties only empty cells" |
| R-O1 | critical | d0f493f | 1C OData: a corrected ЭСФ looked for its original by number + date only. Invoice numbers repeat across sellers, so seller B's correction of №15 PATCHed seller A's №15 receipt in 1C (supplier and lines replaced). The original must now be the same seller's (ИНН) and the same client's, or the same roaming id. The base is searched only when 1C knows the seller. | `onec/odata.test.ts` "a correction replaces only its own seller's receipt…" |
| R-O2 | critical | d0f493f | Every FacturaType ≠ 0 replaced the original receipt, but 1/6/9 are *additional* invoices (didox research §2.1 "SubTypes"): a 1-line additional ЭСФ left the 4-line original with 1 line. Only 4/5/8 replace now. Additional types are receipts of their own. | same test |
| R-O3 | critical | d0f493f | A correction sent in parts (`recordIds`, or lines approved one by one) PATCHed the tabular part with that part only; 1C replaces the whole part, so the receipt went 4 → 3 → 1 lines. It is now refused as `correction_partial` (uz/ru label added) unless every line goes. | same test |
| R-D1 | major | f083aaf | Didox API sync read JSON with plain `JSON.parse`; only uploads used `parseDidoxJson`. A numeric `catalogcode` 10403003014000001 arrived as 10403003014000000 (a valid-looking wrong code), and a 20-digit account was rounded the same way. | `didox/client-docs.test.ts` "a GET document with numeric long codes keeps every digit" |
| R-D2 | major | 3ed1104 | Didox sync skipped every id it had imported before reading its status, so an invoice rejected, cancelled or annulled (by a correction) after the first sync stayed "signed" and exportable. A corrected ЭСФ plus its annulled original could both be booked. The stored status and the status issue now follow Didox. | `didox/real-docs-db.test.ts` "an imported invoice whose Didox status turns void…" |
| R-D3 | major | 8bfebcb | `didox_status_void` (error) sits on the batch, not on a line, so line approval and "approve clean" never saw it, and receipt, nomenclature and OData all exported a cancelled ЭСФ. `planExport` now leaves every line of such a batch out as `invalid`. The Didox export also stops before writing products. | `onec/formats.test.ts` "a voided ЭСФ: approved lines stay home in every format" |
| R-D5 | major | 55daa49 | Didox upload: more than 500 documents (one zip, nested zips or a JSON array) were cut to 500 with "0 skipped". Each document past the cap is now a skipped entry `too_many_documents`. The cap predates S2, but S2's nested zips make it easy to reach. | `didox/sources.test.ts` "past 500 documents…" |
| R-B4 | major | 06089ac | `.xls`: a float RK with the sign bit set (−0.5, large negatives) threw a RangeError in `writeUInt32LE`, and the whole statement was refused as `legacy_xls`. | `bank/xls.test.ts` "RK numbers" |
| R-B5 | major | 88080c1 | Fixed-width text: a payment line of another length (a writer that trims the last field) became a one-cell row that the continuation rule appended to the previous purpose. The 2 340 000 tax payment vanished, and an ASBT export has no balances to catch it. Dated lines with an amount are now cut at the table's spans. | `bank/real-layouts.test.ts` "a payment line of another length…" |
| R-B6 | major | c16068d | An undated payment row (a statement that prints the date once per day) whose purpose holds a noise word ("Aylanma mablagʻlari…", "итого", "сальдо") was dropped as totals, and its amount could become the bank's "printed" totals (S1 made a later totals row replace an earlier one). A row with a document number, counterparty account or ИНН now stays a visible `date_missing` line. | `bank/real-layouts.test.ts` "a statement that prints the date once per day" |
| R-B8 | major | 7eff966 | B3: the batch is created `uploaded` (0 of n) before its lines are stored. A crash in between left part of the lines, and the resume processed them as the whole statement, ending in `review` with lines silently missing (and the same file refused as read before). The run now fails the batch, saying so, when the stored count is not the expected one. | `bank/real-data-db.test.ts` "a statement whose upload stopped while its lines were stored fails" |
| R-P2 | major | 5d9b9dd | Product prices: "12.500" became 12.50 while "12,500" became 12500, and "0,125" became 125 with no warning. Both marks now follow `amount.ts`: thousands, with a new `price_ambiguous` warning (uz/ru labels). A whole part of 0 is a fraction. | `products/real-data.test.ts` "one mark with three digits after it…" |
| R-P3 | major | 5d9b9dd | A formula VAT cell (`12.000000000000014`) made a rate longer than the record's 10 characters, so `ProductRecord.parse` failed and the whole batch's review page and save broke. Rates are rounded to two decimals. | same test |
| R-P4 | major | d736bff | 1C nomenclature: a price from a "Цена без НДС" column with no VAT column was written to «Цена» (VAT-inclusive) as is, so 1C would book it 12 % low. «Цена» now stays empty when the gross cannot be known. Same commit: the as-given path rounded with `Number().toFixed(2)` ("1.005" → 1.00); it now rounds half up in integers (R-D11). | `products/real-data.test.ts` "prices the sale price with VAT…" |
| R-P5 | major | 95557d3 | An empty or damaged ИКПУ cell kept the product's code (§7.30) but wrote the row's verdict over it. A good code then read as `missing`/`invalid` and dropped out of the 1C catalogue export. The verdict and issues are written only when the row carried the code. | `products/import-real.test.ts` (same test as R-P1) |
| R-O4 | major | e546e44 | 1C OData: only bank lines checked the base after a timeout. A receipt POST that 1C wrote but whose answer was lost became a second receipt on "Retry". Invoices now look for the receipt by number, date and counterparty first. | `onec/odata.test.ts` "a receipt whose POST timed out is found in the base on retry" |
| R-O5 | major | 53dc669 | The production (pinned) fetch kept the first 8 MB of a response and answered 200. A real `$metadata` is 10+ MB with its EntityContainer last, so discovery found no entity sets and every transfer was refused as `composition_incomplete`. The cap is now 32 MB (above the 20 MB `odata.ts` reads), and a body past it is an error. | `onec/connection.test.ts` "a body past the cap is refused, never cut" |
| R-O7 | major | 57c59ef | OData product: the default map sends name, full name and article; a product's ИКПУ, package code and barcode were dropped without a word. Each one present but unmapped now adds `<field>_not_sent` to the record's outcome notes. | `onec/connection.test.ts` "a code the object map sends nowhere is noted" |

36c5072 is a lint fix in one of the new tests. Every test above was run against the code before its fix and failed
there (R-B1's without-fix run aborts the test process exactly as the API would).

## Open findings

### Major, left open (a fix is more than a small change, or is a design decision)

| ID | Where | What is wrong, and a failing input | Suggested fix |
|---|---|---|---|
| R-B7 | `onec/bank-exchange.ts:113-122`, `onec/files.ts:45-53`, `onec/plan.ts` | kl_to_1c document numbers are made unique only within one export file. Payments A and B, both `Номер=1` on 30.10 for the same account, exported in two partial exports, each get `Номер=1`, and 1C answers «Документ уже загружен» for B. The merge also dropped S4's loop that skipped numbers already in use, so a real `1/2` next to two `1`s gives two `1/2` (minor part). | Number over the whole batch (all records, by date and row), not over the export, and store the written number on the record's outcome so a later export reuses it. |
| R-B2b | `spreadsheet-text.ts:300-320` (`parseDelimited`), `bank/markup.ts` grids, `bank/text.ts` | No row cap while the grid is built (only `locateTable` cuts at 60 000 rows, afterwards). A direct 20 MB text upload peaks around 1.9 GB of heap (bank reviewer's measurement). This is within Node's default 4.3 GB, but not within a container with a smaller `--max-old-space-size`. | Count rows past `MAX_ROWS` (plus title room) instead of storing them, in `parseDelimited` and the two markup loops. |
| R-O6 | `spreadsheet.ts:67` `numberText`, `onec/requisites.ts:19,80`, also `bank/identifiers.ts:23` | A 20-digit account in an Excel number cell keeps 15 significant digits. `2.02080009056562E+19` becomes `"20208000905656201216"`, which passes `validAccount` and is stored. This affects the counterparties import and bank statements alike, and predates the diff. | Read cell types as the products import does (`numberCells`), and flag a number cell ≥ 1e15 in an account/ИНН column as `account_invalid`. |
| R-D4 | `didox/service.ts:114-120`, `connection.ts:345-351` | A document with the same seller + number + date is refused as `duplicate_invoice` whatever its Didox id or the earlier one's status, and the sync caches the refusal. If a seller re-issues a rejected or cancelled invoice under the same number and date, the valid one is never imported. `service.test.ts:108-115` asserts this refusal deliberately, so it is a product decision. | Skip the number/date rule when the earlier batch is void (now known, R-D2) or the two `facturaid`s differ; do not cache `duplicate_invoice` refusals. |
| R-D6 | `didox/connection.ts:323`, `client.ts:334-340` | The sync stops after 50 pages (5 000 documents) even with `next_page_url` set, and ends `done`. A first sync without a date never reaches older documents. Predates the diff. | Record `truncated` when the loop ends with a next page pending, and continue from that page. |
| R-P11 | `products/keys.ts:38` `displayBarcode` (predates the diff) | EAN-8 `47801271` is stored as GTIN-14 `00000047801271` and written to the catalogue 1C file as `0000047801271`; UPC-A `012345678905` as `0012345678905`. 1C will not match a scan of either. | Strip the padding back to the barcode's own length (8, 12, 13). |
| R-O4b | `onec/transfer.ts:218` | A product POST that timed out is still written again on retry (products have no number to look up by). | Look up by `Description` (and article) before re-creating after a timeout. |

### Minor (left as findings)

| ID | Where | What, and a failing input |
|---|---|---|
| R-B9 | `bank/store.ts:264-276`, `service.ts` `startRun` | Resuming a stalled statement has no database-level claim. Within one process it is safe (synchronous `running`/`inflight` check); two API processes could both resume it and write issues twice. Docker compose runs one `api` today. Fix: `UPDATE … WHERE status='uploaded' AND "updatedAt" < now()-90s RETURNING`. |
| R-B10 | `bank/markup.ts` `htmlGrid` | `rowspan` is ignored: a two-row HTML header shifts the second row, no layout is recognised, and every line gets `amount_missing` (visible; manual mapping recovers it). |
| R-B11 | `spreadsheet-text.ts:201-228` | A cp866 file framed with box-drawing characters is decoded as windows-1251 (they count as Cyrillic in the 1251 reading). |
| R-B12 | `onec/bank-exchange.ts:206-219` | Characters outside cp1251 other than the folded Uzbek ones become `?` in kl_to_1c: "Türkiye Ziraat Bankası Şirket" → `T?rkiye … Bankas? ?irket`. Fix: NFD + strip combining marks, `ı`→`i`. |
| R-B13 | `bank/xls.ts:263` | `extra` counts cells, not rows, past the row limit (overstated by the column count). |
| R-B14 | `bank/duplicates.ts:290-299` | Without a document number the key includes the counterparty account and purpose. A re-export that omits or shortens them is not matched, and a posting-date-only layout keys on another date than kl_to_1c. |
| R-B15 | `onec/bank-exchange.ts:113-117` | The `1/2` suffix key ignores direction, so an incoming and an outgoing document both numbered 58 on one day are renumbered although 1C keeps them in two document types. Harmless, but it changes the bank's own number. |
| R-B16 | `onec/files.ts` | `encoding: 'DOS'` (S4) is reachable only from tests: no production path sets it, and `EXCHANGE_CONTENT_TYPE` stays windows-1251. This is not merge damage (S4 never wired it), but it should be stated as "not available yet". |
| R-B17 | `apps/web` bank upload picker | Accepts `.xlsx,.xls,.csv` only; `.txt`, `.zip` and `.html` statements (S1) can only be dragged in. `contracts/modules/bank.ts:228` still says .xlsx/.csv. |
| R-B18 | `bank/identifiers.ts:28` (predates the diff) | `readMfo('444.0')` → `'04440'` (the dot is dropped, then padded). Only a text cell written that way triggers it. |
| R-D7 | `didox/connection.ts:399-423` | `startSync`/`syncStatus` read, check and write without an atomic claim. Two tabs after a restart, or a slow page (> 90 s between heartbeats) seen by a second process, start two runs. The unique fingerprint index prevents duplicate batches; the cost is doubled calls (a 429 is fatal) and racy counters. Fix: claim with a conditional UPDATE on the old heartbeat; heartbeat per document. |
| R-D8 | `didox/document.ts:358-366` | §7.21 tolerance is looser than the research formula: count 1, price 100.00, delivery sum 100.01 passes (research: ≤ 0.5 tiyin × count). |
| R-D9 | `didox/decimal.ts:28-30` | `readDecimal("1.234,56")` → 1.23456 (spreadsheet text cells only). |
| R-D10 | `didox/rules.ts:215` | §7.26 partly: a missing VAT registration code with VAT status 20/21/22 is not flagged; `districtid` (4 digits) never checked. |
| R-D12 | `didox/sources.ts:316` | The ЭСФ Excel template starts a new invoice on any value in column A; a user who repeats A on every line gets one-line invoices and the rest refused as `duplicate_invoice`. |
| R-D13 | `didox/service.ts:468` | `removeInvoice` keeps the cached Didox document row, and the sync skips cached ids, so a deleted invoice is never synced again. |
| R-D14 | `didox/connection.ts` `passwordLogin` | If Didox echoed the password in a 422 field map, the error shown to the admin who typed it would contain it (not stored, not logged). |
| R-D15 | `didox/real-docs-db.test.ts:164,183` | The background-sync test polls for at most 5 s (100 × 50 ms); under a loaded full run it can time out. |
| R-P6 | `products/checks.ts:177-178` | A formula price `11200.000000000002` rounds correctly but raises `price_precision`, so the row is suspicious and loses the auto-approval. |
| R-P7 | `products/checks.ts:170` | No cap on the price: a 17+ digit price (an ИКПУ column mapped as price) overflows `Decimal(18,2)` and fails the whole save with a generic error. |
| R-P8 | `products/import.ts:290-292` | Re-uploading the same file returns the earlier batch with its original `clearEmpty`, mapping and client, without saying so. |
| R-P9 | `products/import.ts:298` | Rows above the found header (`meta.headerSkipped`) are stored but never shown. |
| R-P10 | `products/classify.ts:111-114` | With tasnif unreachable and nothing cached, a given package code gets `package_unchecked` (info), so the row stays `valid` and is auto-approved for 1C. |
| R-P12 | `products/import.ts:230-240` `rememberedMapping` | A remembered mapping from an earlier file wins over the guess and leaves the new file's extra columns (S3's «Цена», «Ставка НДС») unmapped. Found while writing R-P1's test. Fix: `mergeMappings(remembered, guess)` for fields the remembered one lacks. |
| R-O8 | `onec/review.ts:205-207`, `export.ts:164` | Reopen clears `decidedAt`, so the 10-minute file reuse check (`decidedAt > createdAt`) misses it and serves a cached side file (counterparties, nomenclature) that still contains the reopened record. |
| R-O9 | `onec/counterparties.ts:65-70, 317` | An import row with ИНН + branch code never matches an existing same-ИНН row with a null branch (a second row is created). A «Резидентство» column of Да/Нет is inverted ("Да" matches `/резидент/` → `nonresident`, which also lifts the ИНН requirement). |
| R-O10 | `onec/transfer.ts`, `host-guard.ts` | Edge items: PATCH sends the tabular part without `Товары@odata.type` (the one real PATCH sample has it); the pinned fetch sends no Content-Length (chunked, untested against 1C); `transfer.ts` creates the export row before `meta_invalid` can return (orphan row); no server-side lock on two concurrent transfers of a batch; explicit `recordIds` re-send exported records with only a warning; the host guard is off whenever `NODE_ENV` ≠ `production` (predates the diff; a staging deploy is unguarded); a bank document with no ИНН is created without a counterparty and without a note. |
| R-T1 | tests | Tests that check the code rather than the rule. (1) The `.xls` reader is tested only on files written by the repo's own BIFF writer, which emits no float RK, MULRK, LABEL, FORMULA/STRING or mini-stream; R-B4 slipped through that way (R-B1's and R-B4's tests now build bytes by hand). (2) The merge changed `kl-to-1c-conformance.test.ts:84` from `58-2` to `58/2`, and it checks uniqueness only within one file (R-B7). (3) The OData correction test used `oldFactura.id = externalId`, a relation API imports do not have, which hid R-O1. (4) `real-data.test.ts:306-308` tests `splitVat`, which no production path calls (the 1C path uses `grossPrice`). (5) `real-docs.test.ts:246` checks the §7.21 tolerance only at count 3, where code and research agree. None of these tests was weakened; R-O1…O3, R-P4 and R-B4 now have tests against the rule. |

## What I checked and found sound

- **B5 approval gate**:
  - Every export path goes through `approved()`, which requires `valid`/`corrected` plus an `approve`/`correct` decision.
  - Naming record ids does not approve them, and an exported record's decision cannot be reset.
  - `approvedWhere`/`refreshCounts` and `batchStatusFor` agree with it.
  - Products auto-approve only `valid` rows with no decision; any error makes a row `unresolved`, which is never approved.
  - Bulk approve in bank and Didox excludes error lines.
- **Money arithmetic**:
  - Bank amounts: NBSP, U+202F, apostrophes, `1,234,567.89`, `1.234.567,89`, `(500,00)`, trailing `UZS`/`сум`/`so'm`, BigInt sums. I checked these by hand (research §7.29, §7.30, §7.36).
  - Didox tiyin/micros arithmetic, float noise, 12 % VAT on 892.86 → 107.14, VAT rates by date (20 → 15 → 12, 6 % from 1 June 2026). The research's "15 % from 2026" is its own error; the code is right.
  - `money2` half away from zero; OData count 6 dp, sums 2 dp; header totals from the ЭСФ when every line goes.
  - Product `toTiyin`/`fromTiyin` and the 12/112 split.
- **Leading zeros**:
  - 17-digit ИКПУ, package codes, barcodes and articles are written as text cells in the 1C files.
  - МФО is padded on read (`444` → `00444`; checked against research §7.36).
  - Purpose code 5 digits; document numbers compared without zeros.
  - `parseDidoxJson` quotes long codes in nested arrays and any key case, and leaves amounts alone.
  - `$filter` literals are strings and quotes are doubled (`O'Reilly` → `'O''Reilly'`); dates are `datetime'…'` from the ISO text, with no UTC shift.
- **Security**:
  - Didox zip: nesting depth 2, a shared byte and entry budget across levels, `../` and `C:\` names refused, names used only as labels.
  - Bank zip: inflated bytes counted while streaming, 5 000 entries, a zip in a zip refused.
  - `.xls`: chain cycles, bounds and CONTINUE records terminate. About 10 000 random mutations ended in ≤ 4 ms each, apart from R-B1, now fixed.
  - Didox secrets: tokens travel only in headers, log lines carry no query, `errorDetail` masks every configured secret before truncating, `lastErrorDetail` is stored masked, tokens are AES-GCM sealed, the partner token is read only from `DIDOX_*` variables, and the TTL is checked before every call.
  - OData: no redirect followed on reads or writes. The pinned fetch is used for `$metadata`, paging and `Post()`. IPv4-mapped IPv6 private addresses are refused. The 1C password is never returned or logged.
  - `/api/onec/exports/*/file` is matched by segment, so `…/file/../../connection` reaches no other route. The file stays scoped to the org and the user's clients.
- **Research rules verified against the code** (ten, across the four checklists):
  - bank §7.29 (Д/К flag column), §7.30 (amount formats), §7.36 (numeric МФО) and §7.44 (kl_to_1c: cp1251 without BOM, CRLF, one `СекцияРасчСчет` per own account, `ДатаСписано` only on outgoing and `ДатаПоступило` only on incoming documents, BigInt-cent turnovers);
  - didox §7.17 (30-day grace on `facturadate`) and §7.26 (ИНН 9/14, VAT code 12, МФО 5; partly, see R-D10);
  - products §7.1 (damage reported, never padded: the restored code is only in the issue's params) and §7.13/7.14 (GTIN check digits on 4600682000013, 4006381333931, 73513537, 14780042470124; 02x/04x/2x internal, never sent to tasnif);
  - onec §8.27 (one POST with the tabular part, no `Ref_Key`, rows read back), §8.29 (If-Match + bounded 412 retry), §8.30 (DeletionMark by PATCH, no DELETE) and §8.31 (`$top`/`$skip`/`$inlinecount`, folders out, `allowedOnly` after 401).
  - §7.21 is looser than written (R-D8); every other rule here does what it says.
- **Merge damage**:
  - `onec/files.ts` is exactly S1 plus S3 (S4 never touched it).
  - `onec/sheets.ts` is S3's (S2 did not touch it).
  - `products/import.ts` is S3 plus S4's 5-line approval block.
  - `onec/bank-exchange.ts` lost only S4's skip-numbers-in-use loop (R-B7). DOS output gets both cp866 bytes and `Кодировка=DOS`.
  - The three migrations match `schema.prisma`: `prisma migrate diff` from `mxik_rev` to the schema lists only main's raw-SQL trigram index, nothing on the new columns or the new table.
- **i18n**:
  - uz/ru key sets are identical in all five changed parts (didox 276, onec 238, products 172, bank 330, accounting 57 leaves; recursive comparison, which also covers the `as Record<string,string>` maps the type check does not).
  - Every Didox rule code and every product issue code has both labels.
  - The i18n tests pass (18/18).

## Test runs

- Baseline before any fix (`npm test`, full parallelism, `mxik_rev`): 2 569 tests, 2 564 pass, 1 fail, 4 skipped. The
  failure is the demo suite (`apps/api/test/e2e/demo.test.ts`), which needs the seeded demo template a migrations-only DB
  lacks; the integration notes the same.
- After the fixes: see "Final run" below. Every changed suite also passed on its own: bank 117, Didox 102, products 78
  (plus i18n 93 together), onec 79.
- `npm run typecheck`: exit 0 in every workspace. `eslint` on every file this branch changed: 0 errors. The 1 warning
  (`bank/xls.ts` non-null assertion) predates the branch.

### Final run

`npm test` on the branch tip (full parallelism, `mxik_rev`): **2 593 tests, 2 588 pass, 1 fail, 4 skipped**. The one
failure is the same demo suite as the baseline (no seeded demo template on a scratch DB). The skips are the usual four
(Redis not on 127.0.0.1:6379, and the weighted full-text column is not built on this DB), as in the baseline.

## For the owner / coordinator

- Nothing pushed, nothing merged. The branch has 20 commits on 65bbe01: 18 fixes, 1 lint fix and this document.
- One new uz/ru label each: `accountingX.reasons.correction_partial` and `productsX.issues.price_ambiguous`.
- No migration.
- Drop `mxik_rev` when done.
- This worktree's `node_modules` is a folder of junctions into the main checkout's, plus a copied `@prisma/client` and
  `@tasnivo/*` junctions into this worktree, and `apps/api/node_modules` is a junction. Remove each with
  `cmd /c rmdir <link>` before `git worktree remove`.
