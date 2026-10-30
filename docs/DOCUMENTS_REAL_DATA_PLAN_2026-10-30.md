# Documents modules: make them work for real (plan, 30 Oct 2026)

Owner's ask (30 Oct): the four "documents" modules on the landing page — bank statements, Didox
invoices, products catalogue, 1C import & history — each still say "sinov rejimida" (trial mode,
unverified against real data). Research the real formats deeply, open Opus tasks, fix the gaps, and
run **50+ tests built from real-world material found on the internet**.

Coordinator: this session (`main` at 1afccd1, fresh build, 59 migrations). Four Opus sessions, one per
module, each in its own worktree and branch. **Sessions never push or merge**: they report, the
coordinator merges after the owner's approval.

## 1. What the research found (30 Oct, `tmp/real-docs/`, gitignored)

| Folder | What is in it | Key file |
|---|---|---|
| `CODE_MAP.md` | Routes, services, parsers, exporters, tests, and **8 bugs found by reading the code** for all four modules | §"Bugs and gaps" |
| `bank/` | 1CClientBankExchange 1.02/1.03 official spec, 10 real `kl_to_1c.txt` samples (Habr, kilylabs, odin_palace, odoo-ru, Unact, iBank2), ASBT 4.0 help (Ipoteka), Colvir manual (Aloqabank), Ziraat, Hamkorbank tender ТЗ, CBU instruction п.121 (the 22 regulated statement requisites), 44-item checklist | `bank/RESEARCH.md` §7 |
| `didox/` | **Official Didox integrator docs** (api-docs.didox.uz, 11 sections: hosts, auth, every endpoint, full 002/008/023/041/005 JSON examples, code tables), one **real export ZIP** (json+pdf+readme), 17 JSON samples, 4.9 MB of scraped real cabinet data with hundreds of real MXIK lines, 15 tax-side validation rules, 32-item checklist | `didox/RESEARCH.md` §2, §5, §7 |
| `products/` | tasnif.soliq.uz real API responses (14 JSON files: by-mxik, by-params barcode, units, packages, lgota, groups), package/unit binding rules, barcode rules (GTIN check digit, 02x internal), Excel header vocabulary seen in the wild, VAT/price rules, 34-item checklist | `products/RESEARCH.md` §7 |
| `onec/` | 1C UZ 3.0 **official release notes 3.0.3–3.0.63** (attribute names, ЭДО loader behaviour, Dibank, R-Bank NBU layouts), OData real JSON responses (1C:Fresh docs, 42clouds, mista working POST body), 1CClientBankExchange spec, 38-item checklist | `onec/RESEARCH.md` §8 |

Every claim in those files carries a source URL. Downloaded samples are **untrusted data**: read them,
never execute them, never run an interpreter from inside those folders.

## 2. Bugs already known (from CODE_MAP.md; none has a test)

| # | Module | Bug | Where |
|---|---|---|---|
| B1 | bank | МФО regex lost its backslashes; owner МФО never read, БИК empty in kl_to_1c | `packages/domain/src/bank/sheet.ts:155` |
| B2 | bank | `.xls` refused; text split only on `;` `,` tab (no `~`, `|`, fixed width); cannot read a bank's own `kl_to_1c.txt` although a parser exists | `spreadsheet.ts:144`, `spreadsheet-text.ts`, `onec/bank-exchange.ts:187` |
| B3 | bank | processing fire-and-forget; batch stuck `uploaded` after restart | `bank/service.ts:235` |
| B4 | bank/onec | operation, cash-flow item, contract never reach 1C; kl_to_1c has no ВидОперации; `DEFAULT_OBJECT_MAP` ignores them | `onec/connection.ts:28` |
| B5 | onec | export plan treats `valid`/`corrected` as approved without the reviewer's decision | `onec/plan.ts:145,216` |
| B6 | bank/didox | header totals summed from the lines, so "totals" checks compare lines with themselves | `didox/document.ts:276`, `bank/parse.ts:268` |
| B7 | products | `article` column mapped then dropped; Артикул always empty in 1C file | `products/import.ts:77` |
| B8 | misc | Didox currency hard-coded UZS; sync synchronous, no `dateFrom`, `failed` never counted; ЭСФ sheet columns never remembered; counterparties import rejects МФО without leading zeros; ASCII fallback file name; download links break when onec module is off; `DIDOX_*` env not documented | see CODE_MAP |

## 3. Sessions

Common rules for every session (verbatim, also in each brief):
- Work only in your worktree; never push, never merge, never touch `main`.
- Database: create your own scratch database from migrations (`createdb mxik_<session>` then
  `prisma migrate deploy`), never `createdb -T` on the busy dev DB, never migrate the shared `mxik`.
  Use `127.0.0.1`, not `localhost`.
- Never weaken or delete an existing test. New tests go next to the code they test (`*.test.ts`,
  node:test) or in `apps/api/test/e2e`. Fixtures built from real samples go in the module's
  `fixtures/` folder with a `SOURCES.md` naming the origin of each one (URL and what was changed).
  Copy only what a test needs; strip real names/ИНН of private persons; company data from public docs
  may stay.
- Each real-world test case must cite the checklist item it covers (`// bank §7.26`, `// didox §7.21`).
- Keep the "sinov rejimida" / "unverified" notes in the UI and landing; the owner removes them
  after a real 1C / Didox / bank run. You may sharpen their wording to what is still unverified.
- Report: append `## Sx results` to this file with: bugs fixed (file:line), tests added (count,
  file list, which checklist items), what is still unverified and exactly what the owner must do to
  verify it (one screen or one request each). Commit on your branch; tell the coordinator the branch.
- Secrets: never print or commit `.env`; `DIDOX_*`, `GEMINI_API_KEY` stay out of logs.

### S1 — Bank statements (`feat/docs-s1-bank`)

Goal: a statement from any Uzbek internet bank (ASBT, iABS/КИБ, Colvir, bank-own apps) reads
correctly, the reconcile uses the bank's printed totals, and `kl_to_1c.txt` is both read and written
to the letter of the 1C standard.

Tasks:
1. Fix B1, B2, B3, B6 (bank side). Add `~` / `|` / fixed-width text statements (ASBT configurable
   export, bank §2.3/§7.39), zip-wrapped downloads, UTF-8 BOM, cp866 detection by content.
2. Read a bank's own `kl_to_1c.txt` as an input statement (bank §7.1–25): reuse `onec/bank-exchange.ts`
   parser, harden it on the 10 real samples (duplicate keys, missing КонецДокумента, repeated
   СекцияРасчСчет, composite `ИНН 7765434566\775001001 ОАО …` names, empty budget fields).
3. Excel statements: implement the regulated п.121 layout as the base profile (bank §2.4) and the
   documented vendor shapes (ASBT "Выписка лицевых счетов", Colvir, iABS); two-row merged headers,
   repeated page headers, totals/`Обороты за период` rows, continuation rows, posting date vs document
   date, numeric document numbers and МФО losing zeros, purpose code column or 5-digit prefix.
4. Reconcile with the **printed** opening/closing balances and totals (not line sums); report
   mismatch, do not block.
5. Output `kl_to_1c.txt`: bank §7.44 — cp1251 without BOM, CRLF, one СекцияРасчСчет per account, unique
   (РасчСчет, type, Дата, Номер), ДатаСписано/ДатаПоступило by direction; round-trip test: write → parse
   with our own reader → identical documents.
6. Dedup fingerprint per bank §7.42 (account, date, number, amount, counterparty account, purpose hash)
   so a re-import of an overlapping period yields zero new lines.

Tests to add: **≥ 15**. At least: the 10 real `kl_to_1c` samples parsed with asserted document counts,
balances and encodings; 4 Excel/CSV/TXT fixtures you build strictly from documented layouts (ASBT
delimited + fixed width, п.121 Excel with two-row header and totals, iBank2-style CSV one-file-all-accounts),
1 round-trip. Bench: `scripts/bench-bank.ts` on the new fixtures.

### S2 — Didox invoices (`feat/docs-s2-didox`)

Goal: the parser accepts every real Didox shape, the checks apply the tax-side rules with evidence,
and the API client follows the official docs.

Tasks:
1. Parser per didox §7 P1–P16: PascalCase and lowercase keys, four envelopes (ZIP file JSON, GET
   `data.json`, create `pending_document`, 2020 `{"Factura":…}`), numbers-as-strings with float noise
   (compute in tiyin), `packagecode` string or number, `measureid` null/""/string/int, null buyer
   (one-sided), `facturatype` + `oldfacturadoc`, pharm 008 fields, acts 005, hybrid 023 shape detection,
   zip-of-zips and single-document zip (`<docid>.json` + pdf + readme + optional .p7s).
2. Header totals from the document (`total_delivery_sum` etc.), not from the lines (B6). Currency from
   the document (B8).
3. Checks per didox §5/§7 V17–V32: 17-digit code with leading zeros, active on `facturadate`;
   package bound to that ИКПУ (tasnif mirror); decimal places (count ≤ 6, money ≤ 2); arithmetic in
   tiyin with the documented tolerances; VAT rate set by date (12 / 15 from 2026 / 6 simplified);
   `withoutvat` semantics; flags agree with lines; lgota rules; restricted lists; parties (ИНН 9/14,
   VAT reg code 12, МФО 5, account 20); origin vs service codes; marking; corrected chains; document
   level. Every rule cites its evidence line in RESEARCH.md.
4. API client per didox §1: hosts (`api-partners.didox.uz` prod, `testapi3` sandbox), headers
   (`Partner-Authorization` + `user-key`; company mode `api-key`+`user-key`), `GET /v2/documents` with
   required `page`/`limit` and `next_page_url`, status semantics per doctype, `GET /v1/documents/{id}`
   envelope, `/archive` ZIP, error bodies (401/422/423/429) surfaced verbatim, token TTL 360 min.
   Sync asynchronous with `dateFromUpdated`, `failed` counted (B8). Document `DIDOX_*` in
   `.env.example` and DEPLOY.md.
5. ЭСФ Excel upload: the official 60-column template (reference doc in
   `docs/accounting-2026-10-23/reference/`) as a fixed preset; remember the mapping per org like the
   bank module does.

Tests to add: **≥ 15**. At least: the real export ZIP sample end-to-end (upload → lines → checks);
every official example 02–10 parsed; list/GET envelopes 05, 11, 12; 1C_integration fixtures (float
noise, withoutvat, type 8 + oldfacturadoc, PINFL seller); the didox-auditor real cabinet data as a
bulk parse (hundreds of real MXIK lines) with the package/unit check against the local tasnif mirror;
arithmetic tolerance cases; one fake-server test per new client behaviour.

### S3 — Products catalogue (`feat/docs-s3-products`)

Goal: the catalogue import reads the Excel files Uzbek firms actually keep, the checks apply the tasnif
rules, and the 1C nomenclature file maps without manual work.

Tasks:
1. Fix B7 (store Артикул / internal code; `Product` gets an `article` column via a migration on your
   scratch DB) and the ASCII file-name fallback (B8).
2. Header vocabulary per products §4 (RU, UZ Latin, UZ Cyrillic, 1C, Didox "Мои товары", my.soliq,
   Smartup, Billz, Uzum, Yandex, `Код упаковки ТАСНИФ`, `SPIC`, `CatalogCode`); header row not on row 1.
3. Checks per products §7: 17-digit ИКПУ with Excel float/leading-zero damage **detected and reported**
   (not silently padded); unknown vs transport error; base code (first 11 digits) vs brand code
   mismatch; GTIN check digit (EAN-8/12/13/14), internal 02x codes never sent to tasnif, several
   barcodes per cell; package must belong to that ИКПУ, derive candidates from the unit when empty;
   unit normalisation table (§1.4 ids); fixed-unit codes; duplicates (name, barcode, ИКПУ+package+name);
   price with/without VAT (12/112), VAT column values, tiyin rounding; service rows (origin 3, unit 25);
   30-day grace for changed codes; empty cells must not clear existing values on update.
4. 1C `nomenclature_xlsx`: headers equal the 1C captions (onec §8.7: Наименование, Полное наименование,
   Артикул, Штрихкод, Единица измерения, Ставка НДС, Цена, plus Код из классификатора, Код упаковки);
   leading zeros survive (text cells); services never in «Товары».
5. Tasnif client: `units/all` with `pageSize=100` and `recordTotal` check; 403 on `by-mxik` and
   `success:false` on gtin are both "not found"; 401 on `/integration-nomenclature` is "needs token",
   no retry.

Tests to add: **≥ 12**. At least: 6 Excel fixtures built from the documented header variants; the 14
real tasnif JSON responses as fake-server fixtures driving the package/unit/barcode checks; the
Excel-damage cases; the 1C file golden update with a documented diff.

### S4 — 1C import, history and OData (`feat/docs-s4-onec`)

Goal: the 1C side is correct by the official standard, the OData client behaves like a real 1C
expects, and nothing leaves Tasnivo that a reviewer did not approve.

Tasks:
1. Fix B5 (export only approved records; an export without record ids takes approved ones only) and
   B4 (ВидОперации / cash-flow item / contract into the OData document map; for kl_to_1c, document
   in `onec-formats.md` that the standard has no field and where the operation goes).
2. Counterparties: МФО zero-padding on import (B8); reader for a 1C «Вывести список» XLSX with
   arbitrary columns and header not on row 1 (onec §8.17); validators ИНН 9 / ПИНФЛ 14 / VAT code 12 /
   account 20 (27 budget) / МФО 5; branches (ИНН + код филиала); physical persons; non-residents.
3. OData per onec §8.25–34: entity names discovered from `$metadata` and cached by its hash (never
   hard-coded `Catalog_ЕдиницыИзмерения` vs `Catalog_КлассификаторЕдиницИзмерения`); required sets
   missing from the composition → actionable error (403 may mean an attribute, not the object); no
   redirects on write; one POST creates the document with its tabular part, no `Ref_Key` anywhere;
   documents created unposted, `Post()` separately with 500 surfaced as a business refusal; PATCH resends
   the whole tabular part with `If-Match: DataVersion`, 412 → refetch → retry; delete = `DeletionMark=true`
   via PATCH, never HTTP DELETE; paging `$top/$skip/$inlinecount`, `IsFolder eq false`, `allowedOnly`;
   composite refs with `cast(guid'…')`; dates `datetime'…'` no timezone.
4. Receipt from an ЭСФ in OData (onec §8.35–38): corrected invoice updates instead of duplicating;
   risk flag passed through; count 6 dp, sums 2 dp, totals from the document; marks per line.
5. Download links of bank and product exports must not depend on the onec module flag (B8).
6. `kl_to_1c.txt` conformance: cp1251 without BOM, CRLF, ВерсияФормата, both encodings
   (DOS/Windows) produced and re-parsed; МФО in `…БИК`; document identity unique per file.

Tests to add: **≥ 10**. At least: a fake OData server built from the **real** saved responses
(`onec/samples/odata/*`: list with `odata.metadata`, `$filter/$select`, `$expand`, POST 201 body,
error envelope codes 0–20) exercising discovery, create-with-rows, Post(), 412 retry, DeletionMark,
paging; counterparty reader fixtures; approval gate e2e; kl_to_1c conformance.

## 4. Totals and acceptance

| Session | Tests ≥ | Real sources used |
|---|---|---|
| S1 bank | 15 | 10 real kl_to_1c files, ASBT/Colvir/iBank2 documented layouts, CBU п.121 |
| S2 didox | 15 | official Didox docs examples, 1 real export ZIP, scraped real cabinet data, 1C_integration fixtures |
| S3 products | 12 | 14 real tasnif responses, documented Excel header variants |
| S4 onec | 10 | real OData responses, official 1C spec, UZ 3.0 release notes |
| **Total** | **≥ 52** | |

Done means: typecheck clean, the module's existing tests still pass, the new tests pass on the
session's scratch DB, the results section is written, and the branch is reported to the coordinator.
The coordinator merges S1–S4 into `main` in order (S4 last, it touches shared `onec/` files), runs the
full suite and the three builds, and reports to the owner.

What stays for the owner after this round (cannot be done from the internet): one real bank Excel
from each of their clients' banks, one Didox sandbox token (testapi3, E-IMZO test key from
my3.soliq.uz), and one real «1С:Бухгалтерия для Узбекистана» base to load `kl_to_1c.txt`,
`nomenclature_xlsx` and an OData receipt once. Each session's results section lists the exact
one-step check for its module.

## S3 results

Branch `claude/docs-s3-products-9e2eb6` (worktree `docs-s3-products-9e2eb6`), not pushed. Scratch DB
`mxik_s3` built from migrations, plus a classifier subset copied read-only from `mxik` (80,829 codes:
groups 001–024, classes 03004 and 03304, all service codes, every restricted code; the snapshot,
restricted-code and tax-privilege tables) so the DB suites run instead of skipping.

### Bugs fixed

| Bug | Where | Fix |
|---|---|---|
| B7 Артикул mapped then dropped | `packages/domain/src/products/import.ts:137` (`readRow`), `upsert.ts:73,149`, `catalog.ts:322` | the import keeps `article`; `Product.article` stores it; the catalogue export and the batch export both write it to «Артикул» |
| B8 ASCII file name on hand-over | `packages/domain/src/products/catalog.ts:277-281` | the old pattern `filename*?=` matched the ASCII fallback `filename="…"` first (Cyrillic became `_`); now `filenameFromDisposition`, where the UTF-8 form wins |
| Found on the way: a consumer pack counted in its contents' unit | `products/checks.ts` `packageCountingUnit`, `classify.ts:106` | live card 00405001001106002: «шт. (упаковка) 200 грамм» has `unitId` 4 (gram); a row in «шт» was reported as a unit conflict. A consumer pack or a container now counts as one piece; only a plain-unit package («килограмм») counts in its unit |
| Found on the way: the fake Tasnif client said "not found" for codes it had no answer for | `products/test-fixtures.ts` | it now says `unavailable` (no recorded answer); its "not found" was cached in the shared `mxik_code_state` and raced `products.test.ts` once the import checked every code's card |

Migration: **`20261109000300_product_article_price`** (`product.article`, `price DECIMAL(18,2)`,
`priceIncludesVat`, `vatRate`, index `(orgId, article)`), applied to `mxik_s3` only; rollback in
`docs/accounting-2026-10-23/migrations.md`.

### What changed, by task

1. **Header vocabulary** (`products/import-map.ts`): exact names per field from products §4 (RU, UZ
   Latin, UZ Cyrillic, 1C captions, MoySklad UZ `ИКПУ (MXIK)` / `Код упаковки ТАСНИФ`, magicstore,
   Megagroup, CSI `uz-ffd-spic` / `uzFfdPackageCode`, Uzum `SKU товара`, Yandex `SKU`, buline `Ichki kod` /
   `GTIN, dona`, the Didox ЭСФ names `CatalogCode` / `PackageCode` / `Summa` / `VatRate`, Click `SPIC` /
   `GoodPrice` in tiyin / `VATPercent`), then word hints. New mapped columns `price` and `vat`. The 1C
   preset is completed by the guess for what it leaves out. `locateHeader` finds the header by its words
   when a title or hint row is as wide as the table. Extra columns stay unmapped. Billz, Smartup, my.soliq
   and Didox «Мои товары» publish no column list: they are covered by the common words only.
2. **Checks** (`products/checks.ts`, applied per row in `import.ts` and in `classify.ts` with
   `fileChecks`): §7.1 `mxik_leading_zero` (the restored code is shown, never applied), `mxik_scientific`,
   `mxik_number_cell` (a 17-digit .xlsx number cell; Excel keeps 15 digits); §7.2 unknown vs transport
   (`mxik_not_found` on 403, `mxik_unconfirmed` when tasnif did not answer, `mxik_not_in_copy` when tasnif
   knows a code our copy lacks); §7.3/7.4/7.5 `mxik_base_mismatch` (error), `gtin_brand_code_exists`,
   `gtin_code_conflict`, `gtin_has_code` (barcode → code from the classifier copy first, then `gtin=` live,
   at most 50 per chunk); §7.13/7.14/7.16 several barcodes per cell, GTIN check digit for EAN-8/12/13/14,
   `barcode_internal` for 02x/04x/2x (never sent to tasnif); §7.7/7.8/7.10/7.12 the package must be the
   code's own (`package_not_of_code` is now an **error** from a freshly fetched list, a warning from the
   cache), the package is derived from the unit when empty, `unit_fixed` (error) / `unit_not_allowed`
   (warning), the package name is the card's text; §7.9 the unit table on the §1.4 ids
   (`products/units.ts`); §7.17 `duplicate_row`, `duplicate_name`, `duplicate_barcode`; §7.19/7.20 price
   to tiyin, more than 2 decimals flagged and rounded, `GoodPrice` read as tiyin, with/without VAT from
   the header, VAT cells `12`, `12%`, `QQS 12%`, `0`, `0%`, `без НДС`, `Без налога`, `QQSsiz`, `0.12`
   (an Excel percent cell), 15 % flagged; §7.23 `service_unit`, `service_unit_on_goods`; §7.31
   `mxik_retired_grace` (a warning for 30 days after the copy stopped listing a code, then the old
   error); §7.30 empty cells keep saved values unless the importer ticks «Пустые ячейки стирают значение
   в каталоге» (then only mapped columns clear). The import now fetches every code's package list
   (`packaging: 'all'`, cached 30 days) so an empty package can be derived.
3. **1C `nomenclature_xlsx`** (`onec/sheets.ts`, nomenclature part only): Наименование, Код из
   классификатора, Код упаковки, Единица измерения, Штрихкод, Артикул (columns A–F as before), then
   Полное наименование, Ставка НДС («12%», «0%», «Без НДС»), Цена (a number, VAT-inclusive: a net price
   gets its rate added), Вид номенклатуры (Товар / Услуга). Codes, packages, barcodes and articles are
   text cells. Services (a code starting with 1, or no code and a service unit) go to the sheet
   «Услуги», never among the goods (onec §8.10).
4. **Tasnif client** (`products/tasnif-client.ts`): `gtin()` (only `gtin=`; `success:false` and a page of
   other items are both "not found"), `units()` with `pageSize=100&limit=100` and the `recordTotal` check
   (`incomplete` otherwise), `nomenclature()` where 401 is `needs_token`, not retried and not cached; 403
   on `by-mxik` is `not_found`, cached, not retried. Documented in
   `docs/accounting-2026-10-23/tasnif-catalog.md` §4.
5. **UI**: the wizard's «Цена» / «Ставка НДС» columns and the clear-empty checkbox; every new issue text
   in uz and ru (`packages/i18n/src/i18n-parts/products.ts`); the batch view and the landing products
   card carry the sharpened note (uz: «…nomenklatura faylini haqiqiy 1C (Oʻzbekiston uchun) bazasiga
   yuklash hali sinab koʻrilmagan»).

### Golden diff (`onec/fixtures/nomenclature_xlsx.golden.json`, regenerated with `UPDATE_GOLDEN=1`)

Four columns appended to the header (Полное наименование, Ставка НДС, Цена, Вид номенклатуры) and four
cells per row: the full name equals the name (the demo products have none of their own), VAT and price
are empty (the demo products carry neither), and all three demo products are «Товар». Columns A–F and
every existing cell are unchanged. The invoice-based nomenclature test now finds «Доставка» (unit
«услуга», no code) on «Услуги» instead of among the goods: the same four lines, split 3 + 1.

### Tests added

| File | Tests | Checklist items |
|---|---|---|
| `packages/domain/src/products/real-data.test.ts` (no DB) | 20 | products §7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 7.19, 7.20, 7.23, 7.29, 7.30, 7.31, 7.33, 7.34; onec §8.1, 8.6, 8.7, 8.10, 8.12, 8.17; B7, B8 |
| `packages/domain/src/products/import-real.test.ts` (DB) | 3 | §7.3, 7.4, 7.5, 7.7, 7.12, 7.17, 7.19, 7.30; onec §8.10; B7, B8 end to end |

**23 new tests.** Material: 7 product files with documented header rows (6 .xlsx built with exceljs by
`fixtures/make-fixtures.ts`, 1 CSV) and 14 real tasnif responses served by a fake server
(`tasnifFixtureFetch`); `products/fixtures/SOURCES.md` names each file's URL and what was changed.
Existing tests touched, none weakened: `import.test.ts` (the mapping objects gained `price: -1, vat: -1`;
the expected 1C header list is the new one, plus a new assertion that `ART-1` reaches «Артикул») and
`formats.test.ts` (the 3 + 1 split above, asserted). Not covered: §7.6 marking beyond the existing
`marking_required`; §7.11, 7.21, 7.22, 7.24, 7.25 (ЭСФ lines, S2); §7.26, 7.27, 7.32 (no list or data
source); §7.28 name hygiene.

### Suite on `mxik_s3`

- `npm run typecheck`: clean (all workspaces). `eslint` on every touched folder: clean.
- New and products tests: `real-data.test.ts` 20/20, `import-real.test.ts` 3/3, `import.test.ts`,
  `catalog.test.ts`, `products.test.ts`, `tasnif-client.test.ts`, `onec/formats.test.ts`,
  `onec/export.test.ts`, `xlsx-stream.test.ts`: all pass, 0 skipped (the classifier subset makes the DB
  suites run).
- Full `npm test` (306 files, run while three sibling sessions ran theirs on the same Postgres):
  2,430 tests, 2,410 pass, 18 fail, 2 skipped. The 18 failures sit in 12 suites; most say `sorry, too
  many clients already`. Re-run with `--test-concurrency=2`, the 11 domain/web files among them pass
  (117 tests, 115 pass, 0 fail, 2 skipped). Two API e2e cases still fail on the scratch DB and do not
  touch products: `public-api.test.ts` "check: an optional tnved…" needs code `07306001002000000`
  (group 073 is outside the 80,829-code subset) and `demo.test.ts` "POST /api/demo/open" needs a seeded
  demo organisation. The coordinator's run on the full `mxik` copy should show neither.
- Environment note for the coordinator: the main checkout's `apps/api/node_modules/cookie` is gone
  (only npm's staging folder `.cookie-zEGtZxXR` is left, modified 30 Oct 14:04, not by S3), which makes
  the API typecheck fail in every worktree linked to it. S3 used a local copy in its own worktree and
  did not touch main. Repair: `npm install` in the main checkout.

### Still unverified, and the owner's one-step check

- **Loading the file into a real 1C.** Nothing yet proves that «1С:Бухгалтерия для Узбекистана» maps the
  ten captions without asking, reads «Цена» as VAT-inclusive, or takes «Вид номенклатуры» from a column.
  Check, one screen: in a test base, *Справочники → Номенклатура → Загрузить* (or the ITS processing
  «Загрузка данных из табличного документа») with the file that *Mahsulotlar → Katalog yuklash →
  1C uchun tayyorlash* produces for `packages/domain/src/products/fixtures/onec-nomenclature.xlsx`;
  expect the goods on «Номенклатура», the transport service on «Услуги», «Артикул» LAC-200 / LAC-400 /
  BUT-KG and «Код из классификатора» with its leading zeros.
- **Live tasnif drift.** The recorded answers are from 30 Oct; `by-mxik` changed from "200 + text"
  (23 Oct) to 403 (30 Oct). Both are handled; a third shape would show as `mxik_unconfirmed`, not as a
  wrong verdict.
- **Layouts with no public column list:** Billz, Smartup, my.soliq «Справочник товаров», Didox «Мои
  товары»; Yandex's template starts with the sheet «Инструкция» and the reader takes the first sheet.
  One real export from a client using any of them settles it.
- The web wizard changes were typechecked, not opened in a browser.
